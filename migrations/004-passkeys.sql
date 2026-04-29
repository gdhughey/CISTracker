-- v4: WebAuthn / passkey support
-- One row per registered passkey. A user can have many (one per device/browser).
-- credential_id and public_key are stored as base64url strings as returned by
-- @simplewebauthn/server.

CREATE TABLE IF NOT EXISTS passkeys (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id   TEXT NOT NULL UNIQUE,
    public_key      TEXT NOT NULL,
    counter         INTEGER NOT NULL DEFAULT 0,
    transports      TEXT DEFAULT '',          -- JSON array of transport hints
    device_name     TEXT NOT NULL DEFAULT 'Unnamed device',
    backed_up       INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(user_id);
CREATE INDEX IF NOT EXISTS idx_passkeys_credential ON passkeys(credential_id);
