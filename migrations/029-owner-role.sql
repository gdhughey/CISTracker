-- Add 'owner' to the allowed roles for the users table.
-- SQLite cannot ALTER a CHECK constraint in-place, so we rebuild the table.
PRAGMA foreign_keys = OFF;

CREATE TABLE users_new (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    username         TEXT NOT NULL UNIQUE,
    email            TEXT UNIQUE,
    password_hash    TEXT NOT NULL,
    role             TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user','owner')),
    mfa_secret       TEXT,
    mfa_enabled      INTEGER NOT NULL DEFAULT 0,
    must_change_pw   INTEGER NOT NULL DEFAULT 1,
    failed_logins    INTEGER NOT NULL DEFAULT 0,
    locked_until     TEXT,
    recovery_token   TEXT,
    recovery_expires TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
    student_group    TEXT NOT NULL DEFAULT 'none'
);

INSERT INTO users_new SELECT * FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_recovery ON users(recovery_token);

PRAGMA foreign_keys = ON;
