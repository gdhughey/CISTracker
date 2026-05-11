-- Migration 018: checklist audit type + verified flag on entries
ALTER TABLE inventory_audits ADD COLUMN type TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE audit_entries    ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;
