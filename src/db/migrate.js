'use strict';
const fs = require('fs');
const path = require('path');
const db = require('./connection');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

function getCurrentVersion() {
  try {
    const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get();
    return row && row.v ? row.v : 0;
  } catch {
    return 0;
  }
}

function runMigrations() {
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => /^\d+.*\.sql$/.test(f))
    .sort();

  if (!files.length) {
    console.log('No migration files found.');
    return;
  }

  for (const file of files) {
    const version = parseInt(file.split('-')[0], 10);
    const current = getCurrentVersion();
    if (version <= current) {
      console.log(`Skipping ${file} (already applied)`);
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`Applying ${file}...`);
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(version);
    });
    tx();
    console.log(`  -> ok (version ${version})`);
  }
  console.log('Migrations complete. Current version:', getCurrentVersion());
}

if (require.main === module) {
  runMigrations();
}

module.exports = { runMigrations, getCurrentVersion };
