-- CyberLab on-prem schema v1

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    username         TEXT NOT NULL UNIQUE,
    email            TEXT UNIQUE,
    password_hash    TEXT NOT NULL,
    role             TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
    mfa_secret       TEXT,
    mfa_enabled      INTEGER NOT NULL DEFAULT 0,
    must_change_pw   INTEGER NOT NULL DEFAULT 1,
    failed_logins    INTEGER NOT NULL DEFAULT 0,
    locked_until     TEXT,
    recovery_token   TEXT,
    recovery_expires TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_recovery ON users(recovery_token);

CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip_address  TEXT,
    user_agent  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen   TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS equipment (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    type            TEXT DEFAULT '',
    serial_number   TEXT DEFAULT '',
    barcode         TEXT DEFAULT '',
    category        TEXT DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','checked_out')),
    checked_out_by  INTEGER REFERENCES users(id),
    checked_out_at  TEXT,
    image_path      TEXT,
    notes           TEXT DEFAULT '',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_equipment_status ON equipment(status);
CREATE INDEX IF NOT EXISTS idx_equipment_barcode ON equipment(barcode);
CREATE INDEX IF NOT EXISTS idx_equipment_serial ON equipment(serial_number);

CREATE TABLE IF NOT EXISTS checkout_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    equipment_id    INTEGER NOT NULL REFERENCES equipment(id),
    action          TEXT NOT NULL CHECK(action IN ('checkout','checkin')),
    performed_by    INTEGER NOT NULL REFERENCES users(id),
    checkout_user   TEXT NOT NULL,
    notes           TEXT DEFAULT '',
    source          TEXT DEFAULT 'Manual',
    image_path      TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_checkout_log_equipment ON checkout_log(equipment_id);
CREATE INDEX IF NOT EXISTS idx_checkout_log_user ON checkout_log(performed_by);
CREATE INDEX IF NOT EXISTS idx_checkout_log_created ON checkout_log(created_at);

CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id),
    action      TEXT NOT NULL,
    target      TEXT,
    ip_address  TEXT,
    user_agent  TEXT,
    details     TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

CREATE TABLE IF NOT EXISTS schema_version (
    version    INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
