'use strict';
const crypto = require('crypto');
const config = require('../src/config');
const userService = require('../src/services/userService');
const { runMigrations } = require('../src/db/migrate');

// Generate a strong random temp password — meets the auth complexity rules
// (uppercase, lowercase, digit, symbol, ≥10 chars).
function genStrongTempPassword() {
  // Pull from each class so the password reliably passes validation.
  const upper  = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower  = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbol = '!@#$%&*+-=?';
  const all    = upper + lower + digits + symbol;
  const pick = (set) => set[crypto.randomBytes(1)[0] % set.length];
  let pw = pick(upper) + pick(lower) + pick(digits) + pick(symbol);
  for (let i = pw.length; i < 14; i++) pw += pick(all);
  // Shuffle so the first 4 chars aren't always upper/lower/digit/symbol
  return pw.split('').sort(() => crypto.randomBytes(1)[0] - 128).join('');
}

async function main() {
  runMigrations();
  const existing = userService.getByUsername(config.seed.username);
  if (existing) {
    console.log(`Admin user '${config.seed.username}' already exists. Skipping seed.`);
    return;
  }
  // If SEED_ADMIN_PASSWORD wasn't provided, generate a random one and print it.
  // This is the ONLY time the password is shown — must_change_pw forces a
  // change on first login, so this is safe.
  const password = config.seed.password || genStrongTempPassword();
  const generated = !config.seed.password;
  const user = await userService.createUser({
    username: config.seed.username,
    email: config.seed.email,
    password,
    role: 'admin',
    mustChangePw: 1,
  });
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Seeded admin user');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  username:', user.username);
  console.log('  email:   ', user.email);
  console.log('  password:', password);
  if (generated) {
    console.log('');
    console.log('  ⚠️  RANDOM PASSWORD GENERATED — copy it now.');
    console.log('     Will not be shown again. Set SEED_ADMIN_PASSWORD');
    console.log('     in .env to override on subsequent installs.');
  }
  console.log('  (must change password on first login)');
  console.log('═══════════════════════════════════════════════════════');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
