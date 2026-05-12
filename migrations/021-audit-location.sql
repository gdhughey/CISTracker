-- Migration 021: Add location support to inventory audits
-- Adds location_id to audit_entries (populated from equipment.location_id)
-- Adds scope_location_id to inventory_audits (optional audit scope filter)

ALTER TABLE audit_entries ADD COLUMN location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE inventory_audits ADD COLUMN scope_location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL;
