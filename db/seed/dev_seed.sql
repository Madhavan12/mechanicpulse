-- Dev/local seed data only. Never run against staging or prod.
-- Password for both mechanics is "password123" (bcrypt, cost 10).

BEGIN;

INSERT INTO workshops (id, name, phone_e164, sms_sender_id, timezone)
VALUES ('00000000-0000-0000-0000-000000000001', 'Demo Auto Care', '+61390000000', 'DemoAuto', 'Australia/Melbourne');

INSERT INTO mechanics (id, workshop_id, name, email, password_hash, role) VALUES
('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-000000000001', 'Sam Owner',   'owner@demo.test',
 '$2b$10$lQ7wq85oPhvC1WBdfhNQm.qsKx/JNHQ5s.BOcHHmiXmgxUiKy42Ve', 'owner'),
('00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-000000000001', 'Jo Mechanic', 'jo@demo.test',
 '$2b$10$lQ7wq85oPhvC1WBdfhNQm.qsKx/JNHQ5s.BOcHHmiXmgxUiKy42Ve', 'mechanic');

INSERT INTO customers (id, workshop_id, name, mobile_e164)
VALUES ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-000000000001', 'Alex Customer', '+61412345678');

INSERT INTO vehicles (id, workshop_id, customer_id, rego, make, model, year)
VALUES ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-00000000c001', 'ABC123', 'Toyota', 'Corolla', 2016);

INSERT INTO jobs (id, workshop_id, vehicle_id, customer_id, created_by, odometer_km)
VALUES ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-00000000c001',
        '00000000-0000-0000-0000-00000000a002', 142300);

INSERT INTO inspection_items (id, job_id, title, severity, note, price_cents, position, created_by) VALUES
('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000b001', 'Front brake pads worn', 'red',
 '2mm remaining, metal-on-metal soon', 28900, 0, '00000000-0000-0000-0000-00000000a002'),
('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000b001', 'Wiper blades perished', 'amber',
 NULL, 4500, 1, '00000000-0000-0000-0000-00000000a002');

INSERT INTO media (inspection_item_id, storage_key, content_type, state, width, height, bytes, uploaded_at) VALUES
('00000000-0000-0000-0000-00000000d001', 'dev/workshop-1/job-b001/brakes.jpg', 'image/jpeg', 'ready', 1600, 1200, 245000, now()),
('00000000-0000-0000-0000-00000000d002', 'dev/workshop-1/job-b001/wipers.jpg', 'image/jpeg', 'ready', 1600, 1200, 198000, now());

INSERT INTO events (workshop_id, job_id, type, actor, mechanic_id)
VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000b001', 'job.created', 'mechanic',
        '00000000-0000-0000-0000-00000000a002');

COMMIT;
