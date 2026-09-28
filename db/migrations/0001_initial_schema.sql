-- =====================================================================
-- MechanicPulse — 0001 initial schema (MVP core flow)
-- Target: PostgreSQL 16+ on Amazon RDS (ap-southeast-2)
--
-- Flow this supports:
--   mechanic logs in -> opens a job for a vehicle -> adds inspection items
--   (photo + severity + price) -> sends a report link by SMS -> customer
--   approves/declines each item in the browser -> every step is logged
--   to `events` for measurement.
--
-- Conventions
--   * UUID primary keys (gen_random_uuid), except `events` (bigint identity).
--   * All times are timestamptz (stored UTC, render in workshop timezone).
--   * Money is integer cents. Phone numbers are E.164 only.
--   * Every tenant-owned row carries workshop_id, and child tables use
--     composite FKs (workshop_id, id) so a row can never point at another
--     workshop's data, even through an app bug.
--   * Customer-facing data (reports, report_items, approvals) is append-only.
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid(), digest()
CREATE EXTENSION IF NOT EXISTS citext;    -- case-insensitive email

-- ---------------------------------------------------------------------
-- Enums (mirror packages/shared/types.ts)
-- ---------------------------------------------------------------------
CREATE TYPE subscription_status AS ENUM ('pilot', 'trial', 'active', 'paused', 'cancelled');
CREATE TYPE mechanic_role       AS ENUM ('owner', 'mechanic');
CREATE TYPE job_status          AS ENUM ('open', 'sent', 'decided', 'closed');
CREATE TYPE severity            AS ENUM ('red', 'amber', 'green');
CREATE TYPE media_state         AS ENUM ('pending', 'uploading', 'ready', 'failed');
CREATE TYPE media_kind          AS ENUM ('image', 'video');
CREATE TYPE decision            AS ENUM ('approved', 'declined');
CREATE TYPE sms_status          AS ENUM ('queued', 'sent', 'delivered', 'undelivered', 'failed');
CREATE TYPE actor_type          AS ENUM ('mechanic', 'customer', 'system');

-- ---------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------
CREATE DOMAIN phone_e164 AS text
    CHECK (VALUE ~ '^\+[1-9][0-9]{7,14}$');

CREATE DOMAIN money_cents AS integer
    CHECK (VALUE >= 0);

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END $$;

CREATE FUNCTION forbid_update_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is append-only (% not allowed)', TG_TABLE_NAME, TG_OP;
END $$;

-- ---------------------------------------------------------------------
-- workshops — the tenant
-- ---------------------------------------------------------------------
CREATE TABLE workshops (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name                text NOT NULL CHECK (length(trim(name)) > 0),
    phone_e164          phone_e164,
    abn                 text CHECK (abn ~ '^[0-9]{11}$'),
    sms_sender_id       text CHECK (sms_sender_id ~ '^[A-Za-z0-9 ]{1,11}$'), -- alphanumeric sender, max 11 chars
    timezone            text NOT NULL DEFAULT 'Australia/Melbourne',
    subscription_status subscription_status NOT NULL DEFAULT 'pilot',
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- mechanics — people who log in (email + password, bcrypt)
-- ---------------------------------------------------------------------
CREATE TABLE mechanics (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workshop_id     uuid NOT NULL REFERENCES workshops (id) ON DELETE RESTRICT,
    name            text NOT NULL CHECK (length(trim(name)) > 0),
    email           citext NOT NULL UNIQUE,              -- login is global, not per workshop
    password_hash   text NOT NULL CHECK (password_hash LIKE '$2%'),  -- bcrypt only
    role            mechanic_role NOT NULL DEFAULT 'mechanic',
    is_active       boolean NOT NULL DEFAULT true,
    last_login_at   timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workshop_id, id)
);

-- ---------------------------------------------------------------------
-- customers — the vehicle owner who receives the SMS
-- ---------------------------------------------------------------------
CREATE TABLE customers (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workshop_id         uuid NOT NULL REFERENCES workshops (id) ON DELETE RESTRICT,
    name                text NOT NULL CHECK (length(trim(name)) > 0),
    mobile_e164         phone_e164 NOT NULL,
    sms_opted_out_at    timestamptz,                     -- Spam Act: honour STOP replies
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workshop_id, mobile_e164),                   -- one customer record per number per shop
    UNIQUE (workshop_id, id)
);

-- ---------------------------------------------------------------------
-- vehicles — rego is unique per workshop, not globally
-- ---------------------------------------------------------------------
CREATE TABLE vehicles (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workshop_id     uuid NOT NULL,
    customer_id     uuid NOT NULL,                       -- current owner
    rego            text NOT NULL CHECK (rego ~ '^[A-Z0-9]{1,9}$'),  -- normalised: upper, no spaces
    make            text,
    model           text,
    year            smallint CHECK (year BETWEEN 1900 AND 2100),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workshop_id, rego),
    UNIQUE (workshop_id, id),
    FOREIGN KEY (workshop_id) REFERENCES workshops (id) ON DELETE RESTRICT,
    FOREIGN KEY (workshop_id, customer_id) REFERENCES customers (workshop_id, id) ON DELETE RESTRICT
);

-- ---------------------------------------------------------------------
-- jobs — one visit of a vehicle to the workshop
-- customer_id is stored on the job (not just via vehicle) because it is
-- the person who approves THIS job; vehicle ownership can change later.
-- ---------------------------------------------------------------------
CREATE TABLE jobs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workshop_id     uuid NOT NULL,
    vehicle_id      uuid NOT NULL,
    customer_id     uuid NOT NULL,
    created_by      uuid NOT NULL,                       -- mechanic
    status          job_status NOT NULL DEFAULT 'open',
    odometer_km     integer CHECK (odometer_km >= 0),
    external_ref    text,                                -- job card id in shop's existing software (unused v1)
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    closed_at       timestamptz,
    UNIQUE (workshop_id, id),
    FOREIGN KEY (workshop_id)              REFERENCES workshops (id)                ON DELETE RESTRICT,
    FOREIGN KEY (workshop_id, vehicle_id)  REFERENCES vehicles  (workshop_id, id)   ON DELETE RESTRICT,
    FOREIGN KEY (workshop_id, customer_id) REFERENCES customers (workshop_id, id)   ON DELETE RESTRICT,
    FOREIGN KEY (workshop_id, created_by)  REFERENCES mechanics (workshop_id, id)   ON DELETE RESTRICT,
    CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);

-- ---------------------------------------------------------------------
-- inspection_items — a finding: title, severity, price, photos
-- Editable while drafting. Once sent, the report_items snapshot is what
-- the customer saw — edits here never change a sent report.
-- ---------------------------------------------------------------------
CREATE TABLE inspection_items (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
    title           text NOT NULL CHECK (length(trim(title)) > 0),
    severity        severity NOT NULL,
    note            text,
    price_cents     money_cents NOT NULL,
    position        integer NOT NULL DEFAULT 0 CHECK (position >= 0),
    created_by      uuid REFERENCES mechanics (id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (job_id, id)
);

-- ---------------------------------------------------------------------
-- media — photo/video in S3. Row is created at presign time (pending),
-- flipped to ready when the browser confirms the PUT succeeded.
-- ---------------------------------------------------------------------
CREATE TABLE media (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    inspection_item_id  uuid NOT NULL REFERENCES inspection_items (id) ON DELETE CASCADE,
    storage_key         text NOT NULL UNIQUE,            -- S3 object key, never a full URL
    kind                media_kind NOT NULL DEFAULT 'image',
    content_type        text NOT NULL,
    state               media_state NOT NULL DEFAULT 'pending',
    width               integer CHECK (width  > 0),
    height              integer CHECK (height > 0),
    bytes               integer CHECK (bytes  > 0 AND bytes <= 20 * 1024 * 1024),
    position            integer NOT NULL DEFAULT 0 CHECK (position >= 0),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    uploaded_at         timestamptz,
    CHECK (state <> 'ready' OR (uploaded_at IS NOT NULL AND bytes IS NOT NULL))
);

-- ---------------------------------------------------------------------
-- reports — one SMS link sent for a job. A job can have several
-- (resend, revised quote); only one can be live at a time.
-- The raw token only ever lives in the SMS; we store sha256(token).
-- ---------------------------------------------------------------------
CREATE TABLE reports (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id              uuid NOT NULL REFERENCES jobs (id) ON DELETE RESTRICT,
    token_hash          bytea NOT NULL UNIQUE CHECK (length(token_hash) = 32),
    sent_by             uuid REFERENCES mechanics (id) ON DELETE SET NULL,
    sent_at             timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz NOT NULL DEFAULT now() + interval '7 days',
    first_opened_at     timestamptz,
    decided_at          timestamptz,                     -- customer submitted
    revoked_at          timestamptz,
    total_cents         money_cents NOT NULL DEFAULT 0,  -- sum of report_items, set on send
    CHECK (expires_at > sent_at)
);

-- Only one live (not revoked, not decided) report per job.
CREATE UNIQUE INDEX reports_one_live_per_job
    ON reports (job_id) WHERE revoked_at IS NULL AND decided_at IS NULL;

-- ---------------------------------------------------------------------
-- report_items — frozen copy of each item exactly as the customer saw it
-- ---------------------------------------------------------------------
CREATE TABLE report_items (
    report_id           uuid NOT NULL REFERENCES reports (id) ON DELETE RESTRICT,
    inspection_item_id  uuid NOT NULL REFERENCES inspection_items (id) ON DELETE RESTRICT,
    title               text NOT NULL,
    severity            severity NOT NULL,
    note                text,
    price_cents         money_cents NOT NULL,
    position            integer NOT NULL,
    PRIMARY KEY (report_id, inspection_item_id)
);

-- ---------------------------------------------------------------------
-- approvals — the customer's decision per item. Append-only.
-- ---------------------------------------------------------------------
CREATE TABLE approvals (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id           uuid NOT NULL,
    inspection_item_id  uuid NOT NULL,
    decision            decision NOT NULL,
    signed_name         text NOT NULL CHECK (length(trim(signed_name)) > 0),
    ip_address          inet,
    user_agent          text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (report_id, inspection_item_id),              -- one decision per item per report
    FOREIGN KEY (report_id, inspection_item_id)
        REFERENCES report_items (report_id, inspection_item_id) ON DELETE RESTRICT
);

-- ---------------------------------------------------------------------
-- sms_messages — every outbound SMS, with provider delivery status.
-- Needed for delivery debugging and for the per-workshop SMS cost margin.
-- ---------------------------------------------------------------------
CREATE TABLE sms_messages (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workshop_id         uuid NOT NULL REFERENCES workshops (id) ON DELETE RESTRICT,
    report_id           uuid REFERENCES reports (id) ON DELETE SET NULL,
    to_e164             phone_e164 NOT NULL,
    body                text NOT NULL,
    provider            text NOT NULL,                   -- 'twilio' | AU aggregator, still undecided
    provider_message_id text,
    status              sms_status NOT NULL DEFAULT 'queued',
    error_code          text,
    segments            smallint CHECK (segments > 0),
    cost_micro_aud      integer CHECK (cost_micro_aud >= 0),  -- provider cost, millionths of a dollar
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_message_id)
);

-- ---------------------------------------------------------------------
-- events — measurement layer (sent, opened, decided, upload retries...)
-- Append-only. Keep `type` as text + check so adding one is a 1-line
-- migration and old rows never break.
-- ---------------------------------------------------------------------
CREATE TABLE events (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    workshop_id     uuid NOT NULL REFERENCES workshops (id) ON DELETE RESTRICT,
    job_id          uuid REFERENCES jobs (id) ON DELETE SET NULL,
    report_id       uuid REFERENCES reports (id) ON DELETE SET NULL,
    type            text NOT NULL CHECK (type IN (
                        'job.created', 'item.added', 'item.updated', 'item.deleted',
                        'media.upload_started', 'media.upload_succeeded', 'media.upload_failed',
                        'report.sent', 'report.opened', 'report.revoked', 'report.expired',
                        'approval.submitted', 'job.closed',
                        'sms.sent', 'sms.delivered', 'sms.failed',
                        'mechanic.login'
                    )),
    actor           actor_type NOT NULL,
    mechanic_id     uuid REFERENCES mechanics (id) ON DELETE SET NULL,
    payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at     timestamptz NOT NULL DEFAULT now(),
    CHECK ((actor = 'mechanic') = (mechanic_id IS NOT NULL))
);

-- ---------------------------------------------------------------------
-- Indexes (FKs + the queries the app actually runs)
-- ---------------------------------------------------------------------
CREATE INDEX mechanics_workshop_idx       ON mechanics (workshop_id);
CREATE INDEX vehicles_customer_idx        ON vehicles (workshop_id, customer_id);
CREATE INDEX jobs_workshop_status_idx     ON jobs (workshop_id, status, created_at DESC);  -- mechanic's job list
CREATE INDEX jobs_vehicle_idx             ON jobs (workshop_id, vehicle_id);
CREATE INDEX jobs_customer_idx            ON jobs (workshop_id, customer_id);
CREATE INDEX inspection_items_job_idx     ON inspection_items (job_id, position);
CREATE INDEX media_item_idx               ON media (inspection_item_id, position);
CREATE INDEX media_stuck_idx              ON media (created_at) WHERE state IN ('pending', 'uploading');  -- cleanup sweeper
CREATE INDEX reports_job_idx              ON reports (job_id, sent_at DESC);
CREATE INDEX approvals_report_idx         ON approvals (report_id);
CREATE INDEX sms_messages_report_idx      ON sms_messages (report_id);
CREATE INDEX sms_messages_workshop_idx    ON sms_messages (workshop_id, created_at DESC);
CREATE INDEX events_workshop_time_idx     ON events (workshop_id, occurred_at DESC);
CREATE INDEX events_job_idx               ON events (job_id) WHERE job_id IS NOT NULL;
CREATE INDEX events_report_idx            ON events (report_id) WHERE report_id IS NOT NULL;
CREATE INDEX events_type_time_idx         ON events (type, occurred_at DESC);

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
CREATE TRIGGER workshops_updated_at        BEFORE UPDATE ON workshops        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER mechanics_updated_at        BEFORE UPDATE ON mechanics        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER customers_updated_at        BEFORE UPDATE ON customers        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER vehicles_updated_at         BEFORE UPDATE ON vehicles         FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER jobs_updated_at             BEFORE UPDATE ON jobs             FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER inspection_items_updated_at BEFORE UPDATE ON inspection_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER media_updated_at            BEFORE UPDATE ON media            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER sms_messages_updated_at     BEFORE UPDATE ON sms_messages     FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- What the customer saw and what they agreed to can never be rewritten.
CREATE TRIGGER report_items_append_only BEFORE UPDATE OR DELETE ON report_items FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
CREATE TRIGGER approvals_append_only    BEFORE UPDATE OR DELETE ON approvals    FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
CREATE TRIGGER events_append_only       BEFORE UPDATE OR DELETE ON events       FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

-- Last line of defence: an approval can only land on a live report,
-- even if the API forgets to check.
CREATE FUNCTION approvals_require_live_report() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE r reports%ROWTYPE;
BEGIN
    SELECT * INTO r FROM reports WHERE id = NEW.report_id FOR SHARE;
    IF r.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION 'report % is revoked', NEW.report_id;
    ELSIF r.expires_at <= now() THEN
        RAISE EXCEPTION 'report % has expired', NEW.report_id;
    ELSIF r.decided_at IS NOT NULL THEN
        RAISE EXCEPTION 'report % was already submitted', NEW.report_id;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER approvals_live_report BEFORE INSERT ON approvals
    FOR EACH ROW EXECUTE FUNCTION approvals_require_live_report();

COMMIT;
