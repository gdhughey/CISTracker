'use strict';
//
// Import users from a CSV file. Skips accounts that already exist.
// Sends a welcome email via Resend if RESEND_API_KEY is set in .env.
//
// CSV format (header row required):
//   username,email,role,group
//   Kyle_Brown,kyle.brown@students.cvtech.edu,user,pm
//
// Valid roles:  admin | user        (default: user)
// Valid groups: am | pm | allday | staff | none   (default: none)
//
// Usage:
//   sudo node scripts/import-users.js scripts/new-students.csv
//   sudo node scripts/import-users.js   # defaults to scripts/users.csv
//

require('dotenv').config();
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const userService = require('../src/services/userService');
const { runMigrations } = require('../src/db/migrate');

const VALID_ROLES  = new Set(['admin', 'user']);
const VALID_GROUPS = new Set(['am', 'pm', 'allday', 'staff', 'none']);

const APP_URL    = 'https://cistracker.net';
const API_KEY    = process.env.RESEND_API_KEY || '';
const FROM       = process.env.RESEND_FROM || 'CISTracker <noreply@cistracker.net>';
const SEND_EMAIL = !!API_KEY;

function genTempPassword() {
  const upper  = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower  = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const all    = upper + lower + digits;
  const pick   = (set) => set[crypto.randomBytes(1)[0] % set.length];
  let pw = pick(upper) + pick(lower) + pick(digits);
  for (let i = pw.length; i < 8; i++) pw += pick(all);
  return pw.split('').sort(() => crypto.randomBytes(1)[0] - 128).join('');
}

function parseCSV(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row');

  const header = lines[0].toLowerCase().split(',').map(h => h.trim());
  const idx = {
    username: header.indexOf('username'),
    email:    header.indexOf('email'),
    role:     header.indexOf('role'),
    group:    header.indexOf('group'),
  };
  if (idx.username === -1) throw new Error('CSV missing required column: username');
  if (idx.email    === -1) throw new Error('CSV missing required column: email');

  const users = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    const username = cols[idx.username];
    const email    = cols[idx.email];
    if (!username || !email) {
      console.warn(`  SKIP  row ${i + 1} — missing username or email`);
      continue;
    }
    const role  = idx.role  !== -1 ? cols[idx.role]  : 'user';
    const group = idx.group !== -1 ? cols[idx.group] : 'none';
    users.push({
      username,
      email,
      role:  VALID_ROLES.has(role)   ? role  : 'user',
      group: VALID_GROUPS.has(group) ? group : 'none',
    });
  }
  return users;
}

const esc = (s) => String(s).replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function displayName(username) {
  return username.replace(/_/g, ' ');
}

async function sendWelcomeEmail(u) {
  const name = displayName(u.username);
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#222">
      <h2 style="margin:0 0 12px">Welcome to CISTracker</h2>
      <p>Hi ${esc(name)},</p>
      <p>Your account has been created on CISTracker. Sign in below
         and you'll be prompted to set a new password on your first login.</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:4px 12px 4px 0"><strong>Sign-in URL</strong></td>
            <td><a href="${esc(APP_URL)}">${esc(APP_URL)}</a></td></tr>
        <tr><td style="padding:4px 12px 4px 0"><strong>Username</strong></td>
            <td><code>${esc(u.username)}</code></td></tr>
        <tr><td style="padding:4px 12px 4px 0"><strong>Temporary password</strong></td>
            <td><code>${esc(u.password)}</code></td></tr>
      </table>
      <p style="color:#555;font-size:13px">
        Keep this email private. You'll be required to change the password as soon
        as you log in.
      </p>
    </div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ from: FROM, to: u.email, subject: 'Your CISTracker account', html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

async function main() {
  const csvPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(__dirname, 'users.csv');

  if (!fs.existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}`);
    console.error('Usage: sudo node scripts/import-users.js path/to/file.csv');
    process.exit(1);
  }

  console.log(`Reading: ${csvPath}\n`);
  const users = parseCSV(csvPath);
  console.log(`Found ${users.length} row(s) in CSV\n`);

  runMigrations();

  let created = 0, skipped = 0, failed = 0;
  const toEmail = [];

  for (const u of users) {
    const byUsername = userService.getByUsername(u.username);
    const byEmail    = userService.getByEmail(u.email);

    if (byUsername || byEmail) {
      const who = byUsername ? u.username : u.email;
      console.log(`SKIP  ${u.username.padEnd(28)} already exists (${who})`);
      skipped++;
      continue;
    }

    try {
      const tempPw = genTempPassword();
      const created_user = await userService.createUser({
        username:    u.username,
        email:       u.email,
        password:    tempPw,
        role:        u.role,
        mustChangePw: 1,
      });
      u.password = tempPw;
      userService.updateStudentGroup(created_user.id, u.group);
      created++;
      console.log(`OK    ${u.username.padEnd(28)} ${u.role.padEnd(5)} ${u.group}`);
      if (SEND_EMAIL) toEmail.push(u);
    } catch (err) {
      console.error(`FAIL  ${u.username.padEnd(28)} ${err.message}`);
      failed++;
    }
  }

  // Send all welcome emails in parallel
  let emailed = 0, emailFailed = 0;
  if (SEND_EMAIL && toEmail.length) {
    console.log(`\nSending ${toEmail.length} welcome emails in parallel...`);
    const results = await Promise.allSettled(toEmail.map(u => sendWelcomeEmail(u)));
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'fulfilled') {
        emailed++;
      } else {
        console.warn(`  └ email failed for ${toEmail[i].username}: ${results[i].reason?.message}`);
        emailFailed++;
      }
    }
  }

  console.log('───────────────────────────────────────────');
  console.log(`Total in CSV: ${users.length}`);
  console.log(`Created:      ${created}`);
  console.log(`Skipped:      ${skipped}`);
  console.log(`Failed:       ${failed}`);
  if (SEND_EMAIL) {
    console.log(`Emails sent:  ${emailed}`);
    console.log(`Email errors: ${emailFailed}`);
  } else {
    console.log('Emails:       (skipped — RESEND_API_KEY not set)');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
