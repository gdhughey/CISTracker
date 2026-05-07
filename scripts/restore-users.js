'use strict';
//
// Wipes ALL users except 'admin' and 'Bryceson_McDaniels', then
// re-creates PM and AllDay accounts with fresh temp passwords.
// Sends a welcome email via Resend if RESEND_API_KEY is set in .env.
//
// Usage:
//   sudo node scripts/restore-users.js
//

// Usernames that will NEVER be deleted, regardless of what else is in the DB.
const PROTECTED = new Set(['admin', 'Bryceson_McDaniels']);

require('dotenv').config();
const crypto = require('crypto');
const userService = require('../src/services/userService');
const { runMigrations } = require('../src/db/migrate');

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

const USERS = [
  // ── PM ────────────────────────────────────────────────────────────────────
  { username: 'Chase_Dubois',          email: 'chase.dubois@students.cvtech.edu',          role: 'admin', group: 'pm' },
  { username: 'Brendan_Traffanstedt',  email: 'brendan.traffanstedt@students.cvtech.edu',  role: 'admin', group: 'pm' },

  { username: 'Kyle_Brown',            email: 'kyle.brown@students.cvtech.edu',            role: 'user',  group: 'pm' },
  { username: 'Izacz_Delmarter',       email: 'izacz.delmarter@students.cvtech.edu',       role: 'user',  group: 'pm' },
  { username: 'Mason_DeSpain',         email: 'mason.despain@students.cvtech.edu',         role: 'user',  group: 'pm' },
  { username: 'Cale_Hansing',          email: 'cale.hansing@students.cvtech.edu',          role: 'user',  group: 'pm' },
  { username: 'Taitum_Higdon',         email: 'taitum.higdon@students.cvtech.edu',         role: 'user',  group: 'pm' },
  { username: 'Cameron_Hill',          email: 'cameron.hill@students.cvtech.edu',          role: 'user',  group: 'pm' },
  { username: 'Campbell_Hill',         email: 'campbell.hill@student.cvtech.edu',          role: 'user',  group: 'pm' },
  { username: 'Noah_Neaves',           email: 'noah.neaves@students.cvtech.edu',           role: 'user',  group: 'pm' },
  { username: 'Michael_Patterson',     email: 'michael.patterson@students.cvtech.edu',     role: 'user',  group: 'pm' },
  { username: 'Devon_Richardson',      email: 'devon.richardson@students.cvtech.edu',      role: 'user',  group: 'pm' },
  { username: 'Christain_Sanchez',     email: 'christain.sanchez@students.cvtech.edu',     role: 'user',  group: 'pm' },
  { username: 'Gavin_Satten',          email: 'gavin.satten@students.cvtech.edu',          role: 'user',  group: 'pm' },
  { username: 'Nathan_Washam',         email: 'nathan.washam@students.cvtech.edu',         role: 'user',  group: 'pm' },
  { username: 'Jackson_Zuelsdorf',     email: 'jackson.zuelsdorf@students.cvtech.edu',     role: 'user',  group: 'pm' },
  { username: 'Iestin_Lane',           email: 'iestin.lane@students.cvtech.edu',           role: 'user',  group: 'pm' },

  // ── All Day ───────────────────────────────────────────────────────────────
  { username: 'Garrett_Hughey',        email: 'garrett.hughey@students.cvtech.edu',        role: 'admin', group: 'allday' },
  { username: 'Bryceson_McDaniels',    email: 'bryceson.mcdaniels@students.cvtech.edu',    role: 'admin', group: 'allday' },
  { username: 'Jackson_Reeves',        email: 'jackson.reeves@cvtechonline.net',           role: 'admin', group: 'allday' },

  { username: 'Kyra_Lindsey',          email: 'kyra.lindsey@students.cvtech.edu',          role: 'user',  group: 'allday' },
  { username: 'Gianna_Crawford',       email: 'gianna.crawford@students.cvtech.edu',       role: 'user',  group: 'allday' },
  { username: 'Clarence_Woodberry',    email: 'clarence.woodberry@students.cvtech.edu',    role: 'user',  group: 'allday' },
];

const APP_URL  = 'https://cistracker.net';
const API_KEY  = process.env.RESEND_API_KEY || '';
const FROM     = process.env.RESEND_FROM || 'CISTracker <noreply@cistracker.net>';
const SEND_EMAIL = !!API_KEY;

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
      <p>Your account has been (re)created on the new CISTracker server. Sign in below
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
    body: JSON.stringify({
      from: FROM,
      to:   u.email,
      subject: 'Your CISTracker account',
      html,
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${await res.text()}`);
  }
}

async function main() {
  runMigrations();

  // ── Step 1: Delete every user except protected accounts ───────────────────
  console.log(`Protected accounts (will not be touched): ${[...PROTECTED].join(', ')}\n`);
  console.log('Wiping all non-protected accounts...');
  let wiped = 0;
  for (const u of userService.listAll()) {
    if (PROTECTED.has(u.username)) {
      console.log(`SKIP  ${u.username.padEnd(24)} (protected)`);
      continue;
    }
    userService.deleteUser(u.id);
    console.log(`DEL   ${u.username.padEnd(24)}`);
    wiped++;
  }
  console.log(`Wiped ${wiped} account(s)\n`);

  // ── Step 2: Re-create all users fresh (accounts sequential, emails parallel) ─
  let created = 0, failed = 0;
  const toEmail = [];

  for (const u of USERS) {
    try {
      const tempPw = genTempPassword();
      const created_user = await userService.createUser({
        username: u.username,
        email:    u.email,
        password: tempPw,
        role:     u.role,
        mustChangePw: 1,
      });
      u.password = tempPw;
      userService.updateStudentGroup(created_user.id, u.group);
      created++;
      console.log(`OK    ${u.username.padEnd(24)} ${u.role.padEnd(5)} ${u.group}`);
      if (SEND_EMAIL) toEmail.push(u);
    } catch (err) {
      console.error(`FAIL  ${u.username.padEnd(24)} ${err.message}`);
      failed++;
    }
  }

  // ── Step 3: Send all welcome emails in parallel ───────────────────────────
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
  console.log(`Total:        ${USERS.length}`);
  console.log(`Created:      ${created}`);
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
