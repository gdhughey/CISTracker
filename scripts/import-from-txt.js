'use strict';
//
// Parses the "CIS Tracker Project.txt" format and imports users.
// Generates fresh temp passwords and sends welcome emails via Resend.
//
// Usage:
//   sudo node scripts/import-from-txt.js "/path/to/CIS Tracker Project.txt"
//

require('dotenv').config();
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const userService = require('../src/services/userService');
const { runMigrations } = require('../src/db/migrate');

const APP_URL    = 'https://cistracker.net';
const API_KEY    = process.env.RESEND_API_KEY || '';
const FROM       = process.env.RESEND_FROM || 'CISTracker <noreply@cistracker.net>';
const SEND_EMAIL = !!API_KEY;

function genTempPassword() {
  const upper  = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower  = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbol = '!@#$';
  const all    = upper + lower + digits + symbol;
  const pick   = (set) => set[crypto.randomBytes(1)[0] % set.length];
  let pw = pick(upper) + pick(lower) + pick(digits) + pick(symbol);
  for (let i = pw.length; i < 6; i++) pw += pick(all);
  return pw.split('').sort(() => crypto.randomBytes(1)[0] - 128).join('');
}

function parseTxt(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map(l => l.trim());

  const GROUP_MAP = { 'pm': 'pm', 'am': 'am', 'all day': 'allday' };
  const users = [];

  let group = 'none';
  let role  = 'user';
  let cur   = {};

  for (const line of lines) {
    const low = line.toLowerCase();

    // Section headers: PM / AM / All Day
    if (GROUP_MAP[low] !== undefined) {
      group = GROUP_MAP[low];
      continue;
    }
    // Role headers
    if (low === 'admins') { role = 'admin'; continue; }
    if (low === 'users')  { role = 'user';  continue; }

    // Data lines
    if (low.startsWith('email-')) {
      cur.email = line.replace(/^email-\s*/i, '').trim();
      continue;
    }
    if (low.startsWith('user-')) {
      cur.username = line.replace(/^user-\s*/i, '').trim();
      continue;
    }
    // "Temp Pass-" line signals end of a user block — save and reset
    if (low.startsWith('temp pass-')) {
      if (cur.username && cur.email) {
        users.push({ username: cur.username, email: cur.email, role, group });
      }
      cur = {};
      continue;
    }
  }
  // Catch any trailing block without a Temp Pass line
  if (cur.username && cur.email) {
    users.push({ username: cur.username, email: cur.email, role, group });
  }

  return users;
}

const esc = (s) => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function sendWelcomeEmail(u) {
  const name = u.username.replace(/_/g, ' ');
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#222">
      <h2 style="margin:0 0 12px">Welcome to CISTracker</h2>
      <p>Hi ${esc(name)},</p>
      <p>Your account has been created. Sign in at the link below —
         you'll be prompted to set a new password on your first login.</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:4px 12px 4px 0"><strong>Sign-in URL</strong></td>
            <td><a href="${APP_URL}">${APP_URL}</a></td></tr>
        <tr><td style="padding:4px 12px 4px 0"><strong>Username</strong></td>
            <td><code>${esc(u.username)}</code></td></tr>
        <tr><td style="padding:4px 12px 4px 0"><strong>Temporary password</strong></td>
            <td><code>${esc(u.password)}</code></td></tr>
      </table>
      <p style="color:#555;font-size:13px">Keep this email private. You must change the password on first login.</p>
    </div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: u.email, subject: 'Your CISTracker account', html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

async function main() {
  const args = process.argv.slice(2);
  const resendOnly = args.includes('--resend-emails');
  const filePath = args.find(a => !a.startsWith('--'));
  if (!filePath || !fs.existsSync(filePath)) {
    console.error('Usage: sudo node scripts/import-from-txt.js "/path/to/file.txt" [--resend-emails]');
    process.exit(1);
  }

  console.log(`Reading: ${filePath}\n`);
  const users = parseTxt(filePath);
  console.log(`Found ${users.length} users\n`);

  runMigrations();

  let created = 0, skipped = 0, failed = 0;
  const toEmail = [];

  for (const u of users) {
    const existing = userService.getByUsername(u.username) || userService.getByEmail(u.email);
    if (existing) {
      if (resendOnly) {
        // Queue email resend with a new temp password
        const tempPw = genTempPassword();
        await userService.setPassword(existing.id, tempPw);
        userService.forcePwChange(existing.id);
        u.password = tempPw;
        toEmail.push(u);
        console.log(`RESEND ${u.username.padEnd(28)} queued`);
      } else {
        console.log(`SKIP  ${u.username.padEnd(28)} already exists`);
      }
      skipped++;
      continue;
    }
    try {
      const tempPw = genTempPassword();
      const newUser = await userService.createUser({
        username: u.username, email: u.email,
        password: tempPw, role: u.role, mustChangePw: 1,
      });
      userService.updateStudentGroup(newUser.id, u.group);
      u.password = tempPw;
      created++;
      console.log(`OK    ${u.username.padEnd(28)} ${u.role.padEnd(5)} ${u.group}`);
      if (SEND_EMAIL) toEmail.push(u);
    } catch (err) {
      console.error(`FAIL  ${u.username.padEnd(28)} ${err.message}`);
      failed++;
    }
  }

  let emailed = 0, emailFailed = 0;
  if (SEND_EMAIL && toEmail.length) {
    console.log(`\nSending ${toEmail.length} welcome emails (rate-limited)...`);
    for (const u of toEmail) {
      try {
        await sendWelcomeEmail(u);
        console.log(`  emailed ${u.username}`);
        emailed++;
      } catch (err) {
        console.warn(`  email failed for ${u.username}: ${err.message}`);
        emailFailed++;
      }
      await new Promise(r => setTimeout(r, 300)); // stay under 5/sec
    }
  }

  console.log('\n───────────────────────────────────────────');
  console.log(`Total found:  ${users.length}`);
  console.log(`Created:      ${created}`);
  console.log(`Skipped:      ${skipped}`);
  console.log(`Failed:       ${failed}`);
  if (SEND_EMAIL) {
    console.log(`Emails sent:  ${emailed}`);
    console.log(`Email errors: ${emailFailed}`);
  } else {
    console.log('Emails:       (skipped — RESEND_API_KEY not set in .env)');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
