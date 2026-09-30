-- Schema smoke tests. Run after 0001 + dev_seed on a throwaway database:
--   psql -v ON_ERROR_STOP=1 -d <db> -f db/tests/schema_checks.sql
-- Each "must fail" case runs in a savepoint and raises if it unexpectedly succeeds.

BEGIN;

CREATE FUNCTION pg_temp.must_fail(sql text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE sql;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'PASS (rejected): % -> %', label, SQLERRM;
        RETURN;
    END;
    RAISE EXCEPTION 'FAIL: % was accepted but should have been rejected', label;
END $$;

-- ---- happy path: send report, customer decides -----------------------
INSERT INTO reports (id, job_id, token_hash, sent_by, total_cents)
VALUES ('00000000-0000-0000-0000-0000000f0001', '00000000-0000-0000-0000-00000000b001',
        digest('raw-token-from-sms', 'sha256'), '00000000-0000-0000-0000-00000000a002', 33400);

INSERT INTO report_items (report_id, inspection_item_id, title, severity, note, price_cents, position)
SELECT '00000000-0000-0000-0000-0000000f0001', id, title, severity, note, price_cents, position
FROM inspection_items WHERE job_id = '00000000-0000-0000-0000-00000000b001';

UPDATE jobs SET status = 'sent' WHERE id = '00000000-0000-0000-0000-00000000b001';

-- token lookup the report page will do
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM reports WHERE token_hash = digest('raw-token-from-sms','sha256')
                   AND revoked_at IS NULL AND expires_at > now()) THEN
        RAISE EXCEPTION 'FAIL: token lookup'; END IF;
    RAISE NOTICE 'PASS: token lookup by hash';
END $$;

-- editing the draft item after sending must not change what the customer saw
UPDATE inspection_items SET price_cents = 99999 WHERE id = '00000000-0000-0000-0000-00000000d001';
DO $$ BEGIN
    IF (SELECT price_cents FROM report_items WHERE inspection_item_id = '00000000-0000-0000-0000-00000000d001') <> 28900 THEN
        RAISE EXCEPTION 'FAIL: snapshot changed'; END IF;
    RAISE NOTICE 'PASS: report snapshot is independent of later edits';
END $$;

-- ---- guardrails ------------------------------------------------------
SELECT pg_temp.must_fail($$INSERT INTO reports (job_id, token_hash) VALUES
    ('00000000-0000-0000-0000-00000000b001', digest('second','sha256'))$$, 'second live report for same job');

SELECT pg_temp.must_fail($$UPDATE report_items SET price_cents = 1$$, 'rewriting report_items');

SELECT pg_temp.must_fail($$INSERT INTO approvals (report_id, inspection_item_id, decision, signed_name)
    VALUES ('00000000-0000-0000-0000-0000000f0001', gen_random_uuid(), 'approved', 'Alex')$$,
    'approval for item not in report');

SELECT pg_temp.must_fail($$INSERT INTO customers (workshop_id, name, mobile_e164)
    VALUES ('00000000-0000-0000-0000-000000000001', 'Bad', '0412345678')$$, 'non-E.164 mobile');

SELECT pg_temp.must_fail($$INSERT INTO vehicles (workshop_id, customer_id, rego)
    VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000c001', 'abc 123')$$,
    'un-normalised rego');

SELECT pg_temp.must_fail($$INSERT INTO inspection_items (job_id, title, severity, price_cents)
    VALUES ('00000000-0000-0000-0000-00000000b001', 'x', 'red', -1)$$, 'negative price');

SELECT pg_temp.must_fail($$INSERT INTO mechanics (workshop_id, name, email, password_hash)
    VALUES ('00000000-0000-0000-0000-000000000001', 'Dup', 'JO@DEMO.TEST', '$2b$10$x')$$,
    'duplicate email (case-insensitive)');

SELECT pg_temp.must_fail($$INSERT INTO mechanics (workshop_id, name, email, password_hash)
    VALUES ('00000000-0000-0000-0000-000000000001', 'Plain', 'plain@demo.test', 'hunter2')$$,
    'non-bcrypt password_hash');

-- cross-tenant: a job in workshop 2 pointing at workshop 1's vehicle
INSERT INTO workshops (id, name) VALUES ('00000000-0000-0000-0000-000000000002', 'Other Shop');
INSERT INTO mechanics (id, workshop_id, name, email, password_hash)
VALUES ('00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-000000000002', 'Other', 'o@other.test', '$2b$10$x');
SELECT pg_temp.must_fail($$INSERT INTO jobs (workshop_id, vehicle_id, customer_id, created_by)
    VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000e001',
            '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000a003')$$,
    'cross-workshop job -> vehicle');

SELECT pg_temp.must_fail($$INSERT INTO media (inspection_item_id, storage_key, content_type, state)
    VALUES ('00000000-0000-0000-0000-00000000d001', 'k/ready-no-upload', 'image/jpeg', 'ready')$$,
    'media ready without uploaded_at/bytes');

-- customer decides
INSERT INTO approvals (report_id, inspection_item_id, decision, signed_name) VALUES
('00000000-0000-0000-0000-0000000f0001', '00000000-0000-0000-0000-00000000d001', 'approved', 'Alex Customer'),
('00000000-0000-0000-0000-0000000f0001', '00000000-0000-0000-0000-00000000d002', 'declined', 'Alex Customer');
UPDATE reports SET decided_at = now() WHERE id = '00000000-0000-0000-0000-0000000f0001';
UPDATE jobs SET status = 'decided' WHERE id = '00000000-0000-0000-0000-00000000b001';

SELECT pg_temp.must_fail($$UPDATE approvals SET decision = 'approved'$$, 'changing an approval');
SELECT pg_temp.must_fail($$INSERT INTO approvals (report_id, inspection_item_id, decision, signed_name)
    VALUES ('00000000-0000-0000-0000-0000000f0001', '00000000-0000-0000-0000-00000000d002', 'approved', 'Alex')$$,
    'second decision on same item');

-- a new report can be sent now that the old one is decided; revoked report blocks approvals
INSERT INTO reports (id, job_id, token_hash, revoked_at)
VALUES ('00000000-0000-0000-0000-0000000f0002', '00000000-0000-0000-0000-00000000b001', digest('t2','sha256'), now());
INSERT INTO report_items (report_id, inspection_item_id, title, severity, price_cents, position)
VALUES ('00000000-0000-0000-0000-0000000f0002', '00000000-0000-0000-0000-00000000d002', 'Wipers', 'amber', 4500, 0);
SELECT pg_temp.must_fail($$INSERT INTO approvals (report_id, inspection_item_id, decision, signed_name)
    VALUES ('00000000-0000-0000-0000-0000000f0002', '00000000-0000-0000-0000-00000000d002', 'approved', 'Alex')$$,
    'approval on revoked report');

SELECT pg_temp.must_fail($$DELETE FROM events$$, 'deleting events');

-- metric query the measurement layer exists for: approval rate + time to decision
SELECT r.id AS report_id,
       count(*) FILTER (WHERE a.decision = 'approved')                    AS approved,
       count(a.*)                                                          AS decided,
       sum(ri.price_cents) FILTER (WHERE a.decision = 'approved') / 100.0  AS approved_aud,
       r.decided_at - r.sent_at                                            AS time_to_decision
FROM reports r
JOIN report_items ri ON ri.report_id = r.id
LEFT JOIN approvals a ON a.report_id = ri.report_id AND a.inspection_item_id = ri.inspection_item_id
WHERE r.id = '00000000-0000-0000-0000-0000000f0001'
GROUP BY r.id;

ROLLBACK;  -- leave the database as seeded
