-- Storage v2: libraries, folders, sharing, starring, trash
-- Safe migration: creates new tables, skips columns that may already exist

CREATE TABLE IF NOT EXISTS storage_libraries (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT    NOT NULL,
  owner_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type      TEXT    NOT NULL DEFAULT 'personal',
  encrypted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT   NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS storage_folders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id INTEGER NOT NULL REFERENCES storage_libraries(id) ON DELETE CASCADE,
  parent_id  INTEGER REFERENCES storage_folders(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS storage_shares (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id INTEGER REFERENCES storage_libraries(id) ON DELETE CASCADE,
  file_id    INTEGER REFERENCES storage_files(id)     ON DELETE CASCADE,
  shared_to  INTEGER REFERENCES users(id)             ON DELETE CASCADE,
  permission TEXT    NOT NULL DEFAULT 'view',
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Recreate storage_files with all columns (rename old, create new, copy, drop old)
CREATE TABLE IF NOT EXISTS storage_files_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  filename      TEXT    NOT NULL,
  original_name TEXT    NOT NULL,
  mimetype      TEXT,
  size          INTEGER NOT NULL DEFAULT 0,
  folder        TEXT    NOT NULL DEFAULT '/',
  library_id    INTEGER REFERENCES storage_libraries(id) ON DELETE CASCADE,
  folder_id     INTEGER REFERENCES storage_folders(id)   ON DELETE SET NULL,
  uploaded_by   INTEGER REFERENCES users(id),
  starred       INTEGER NOT NULL DEFAULT 0,
  trashed       INTEGER NOT NULL DEFAULT 0,
  trashed_at    TEXT,
  shared_token  TEXT UNIQUE,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT OR IGNORE INTO storage_files_new
  (id, filename, original_name, mimetype, size, folder, uploaded_by, created_at)
  SELECT id, filename, original_name, mimetype, size, folder, uploaded_by, created_at
  FROM storage_files;

DROP TABLE storage_files;
ALTER TABLE storage_files_new RENAME TO storage_files;

CREATE INDEX IF NOT EXISTS idx_storage_files_library  ON storage_files(library_id);
CREATE INDEX IF NOT EXISTS idx_storage_files_folder   ON storage_files(folder_id);
CREATE INDEX IF NOT EXISTS idx_storage_files_trashed  ON storage_files(trashed);
CREATE INDEX IF NOT EXISTS idx_storage_folders_lib    ON storage_folders(library_id);
