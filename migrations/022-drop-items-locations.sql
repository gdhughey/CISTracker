-- Drop all items and locations data to start fresh.
-- Order matters: drop child tables before parent tables to satisfy FK constraints.
-- All other tables (users, sessions, tickets, service_tickets, inventory_audits,
-- audit_log, passkeys, categories, models) are untouched.

DROP TABLE IF EXISTS equipment_units;
DROP TABLE IF EXISTS checkout_log;
DROP TABLE IF EXISTS equipment_queue;
DROP TABLE IF EXISTS equipment;
DROP TABLE IF EXISTS locations;
