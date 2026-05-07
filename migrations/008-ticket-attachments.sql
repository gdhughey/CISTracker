CREATE TABLE IF NOT EXISTS ticket_attachments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id    INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  filename     TEXT    NOT NULL,
  original_name TEXT   NOT NULL,
  mimetype     TEXT    NOT NULL,
  size         INTEGER NOT NULL,
  uploaded_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
