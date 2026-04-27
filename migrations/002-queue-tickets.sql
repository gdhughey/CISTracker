-- v2: Queue (waitlist) system + Support tickets

-- Equipment queue / waitlist
CREATE TABLE IF NOT EXISTS equipment_queue (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    equipment_id    INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    position        INTEGER NOT NULL DEFAULT 0,
    notified        INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(equipment_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_queue_equipment ON equipment_queue(equipment_id, position);
CREATE INDEX IF NOT EXISTS idx_queue_user ON equipment_queue(user_id);

-- Support / issue tickets
CREATE TABLE IF NOT EXISTS tickets (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id),
    subject         TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved','closed')),
    priority        TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
    equipment_id    INTEGER REFERENCES equipment(id),
    assigned_to     INTEGER REFERENCES users(id),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned ON tickets(assigned_to);

-- Ticket comments / replies
CREATE TABLE IF NOT EXISTS ticket_comments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    body        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket ON ticket_comments(ticket_id);

-- Add location column to equipment (used in new UI)
ALTER TABLE equipment ADD COLUMN location TEXT DEFAULT '';
