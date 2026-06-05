CREATE TABLE IF NOT EXISTS storage_files (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  filename      TEXT    NOT NULL,
  original_name TEXT    NOT NULL,
  mimetype      TEXT,
  size          INTEGER NOT NULL DEFAULT 0,
  folder        TEXT    NOT NULL DEFAULT '/',
  uploaded_by   INTEGER REFERENCES users(id),
  created_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
