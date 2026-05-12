-- Drop all items and locations data to start fresh.
-- Removes equipment_units first (FK on equipment), then checkout_log,
-- equipment_queue, equipment, and locations.
-- All other tables (users, tickets, audits, service_tickets, etc.) are untouched.

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS equipment_units;
DROP TABLE IF EXISTS checkout_log;
DROP TABLE IF EXISTS equipment_queue;
DROP TABLE IF EXISTS equipment;
DROP TABLE IF EXISTS locations;

PRAGMA foreign_keys = ON;
