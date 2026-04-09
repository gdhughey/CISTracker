'use strict';
const config = require('../src/config');
const userService = require('../src/services/userService');
const { runMigrations } = require('../src/db/migrate');

async function main() {
  runMigrations();
  const existing = userService.getByUsername(config.seed.username);
  if (existing) {
    console.log(`Admin user '${config.seed.username}' already exists. Skipping seed.`);
    return;
  }
  const user = await userService.createUser({
    username: config.seed.username,
    email: config.seed.email,
    password: config.seed.password,
    role: 'admin',
    mustChangePw: 1,
  });
  console.log('Seeded admin user:');
  console.log('  username:', user.username);
  console.log('  email:   ', user.email);
  console.log('  password:', config.seed.password);
  console.log('  (must change password on first login)');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
