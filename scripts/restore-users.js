'use strict';
//
// Restore deleted accounts with fresh generated temp passwords.
// Idempotent — skips users that already exist by username OR email.
// Sends a welcome email via Resend if RESEND_API_KEY is set in .env.
//
// Usage:
//   sudo node scripts/restore-users.js
//

const crypto = require('crypto');
const userService = require('../src/services/userService');
const { runMigrations } = require('../src/db/migrate');

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

  // ── AM ────────────────────────────────────────────────────────────────────
  { username: 'Carsen_Renegar',        email: 'carsen.renegar@students.cvtech.edu',        role: 'admin', group: 'am' },

  { username: 'Simeon_Angelov',        email: 'simeon.angelov@students.cvtech.edu',        role: 'user',  group: 'am' },
  { username: 'Zayden_Arney',          email: 'zayden.arney@students.cvtech.edu',          role: 'user',  group: 'am' },
  { username: 'Isaiah_Boice',          email: 'isaiah.boice@students.cvtech.edu',          role: 'user',  group: 'am' },
  { username: 'Mai_Brouhard',          email: 'mai.brouhard@students.cvtech.edu',          role: 'user',  group: 'am' },
  { username: 'Rylen_Chamberlain',     email: 'rylen.chamberlain@students.cvtech.edu',     role: 'user',  group: 'am' },
  { username: 'Alyssa_Deakins',        email: 'alyssa.deakins@students.cvtech.edu',        role: 'user',  group: 'am' },
  { username: 'Jacob_Faerber',         email: 'jacob.faerber@students.cvtech.edu',         role: 'user',  group: 'am' },
  { username: 'Robert_Genzler',        email: 'robert.genzler@students.cvtech.edu',        role: 'user',  group: 'am' },
  { username: 'Huy_Huynh',             email: 'huy.huynh@students.cvtech.edu',             role: 'user',  group: 'am' },
  { username: 'Devon_James',           email: 'devon.james@students.cvtech.edu',           role: 'user',  group: 'am' },
  { username: 'Luke_Labus',            email: 'luke.labus@students.cvtech.edu',            role: 'user',  group: 'am' },
  { username: 'Eric_Pouncy',           email: 'eric.pouncy@students.cvtech.edu',           role: 'user',  group: 'am' },
  { username: 'Grant_Rayburn',         email: 'grant.rayburn@students.cvtech.edu',         role: 'user',  group: 'am' },
  { username: 'Cooper_Remy',           email: 'cooper.remy@students.cvtech.edu',           role: 'user',  group: 'am' },
  { username: 'Cole_Washington',       email: 'cole.washington@students.cvtech.edu',       role: 'user',  group: 'am' },
  { username: 'Braxton_Wood',          email: 'braxton.wood@students.cvtech.edu',          role: 'user',  group: 'am' },

  // ── All Day ───────────────────────────────────────────────────────────────
  { username: 'Garrett_Hughey',        email: 'garrett.hughey@students.cvtech.edu',        role: 'admin', group: 'allday' },
  { username: 'Bryceson_McDaniels',    email: 'bryceson.mcdaniels@students.cvtech.edu',    role: 'admin', group: 'allday' },
  { username: 'Jackson_Reeves',        email: 'jackson.reeves@students.cvtech.edu',        role: 'admin', group: 'allday' },

  { username: 'Kyra_Lindsey',          email: 'kyra.lindsey@students.cvtech.edu',          role: 'user',  group: 'allday' },
  { username: 'Gianna_Crawford',       email: 'gianna.crawford@students.cvtech.edu',       role: 'user',  group: 'allday' },
  { username: 'Clarence_Woodberry',    email: 'clarence.woodberry@students.cvtech.edu',    role: 'user',  group: 'allday' },
];

const APP_URL  = process.env.APP_URL || 'https://cistracker.net';
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

  let created = 0, skipped = 0, failed = 0, emailed = 0, emailFailed = 0;

  for (const u of USERS) {
    try {
      const dupUser  = userService.getByUsername(u.username);
      const dupEmail = userService.getByEmail(u.email);
      if (dupUser || dupEmail) {
        const why = dupUser ? 'username' : 'email';
        console.log(`SKIP  ${u.username.padEnd(24)} (${why} already in use)`);
        skipped++;
        continue;
      }

      const tempPw = genTempPassword();
      const created_user = await userService.createUser({
        username: u.username,
        email:    u.email,
        password: tempPw,
        role:     u.role,
        mustChangePw: 1,
      });
      u.password = tempPw; // make available for email
      if (u.group && u.group !== 'none') {
        userService.updateStudentGroup(created_user.id, u.group);
      }
      created++;
      console.log(`OK    ${u.username.padEnd(24)} ${u.role.padEnd(5)} ${u.group}`);

      if (SEND_EMAIL) {
        try {
          await sendWelcomeEmail(u);
          emailed++;
        } catch (err) {
          console.warn(`      └ email failed: ${err.message}`);
          emailFailed++;
        }
      }
    } catch (err) {
      console.error(`FAIL  ${u.username.padEnd(24)} ${err.message}`);
      failed++;
    }
  }

  console.log('───────────────────────────────────────────');
  console.log(`Total:        ${USERS.length}`);
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
