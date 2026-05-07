'use strict';
//
// Restore deleted accounts with their original temp passwords.
// Idempotent — skips users that already exist by username OR email.
// Sends a welcome email via Resend if RESEND_API_KEY is set in .env.
//
// Usage:
//   sudo -u cistracker RESEND_API_KEY=... node scripts/restore-users.js
//   (or just `node scripts/restore-users.js` to create users without email)
//

const userService = require('../src/services/userService');
const { runMigrations } = require('../src/db/migrate');

const USERS = [
  // ── PM ────────────────────────────────────────────────────────────────────
  { username: 'Chase_Dubois',          email: 'chase.dubois@students.cvtech.edu',          password: 'qUBSLyN', role: 'admin', group: 'pm' },
  { username: 'Brendan_Traffanstedt',  email: 'brendan.traffanstedt@students.cvtech.edu',  password: 'rT2Euc4', role: 'admin', group: 'pm' },

  { username: 'Kyle_Brown',            email: 'kyle.brown@students.cvtech.edu',            password: '7BLvc85', role: 'user',  group: 'pm' },
  { username: 'Izacz_Delmarter',       email: 'izacz.delmarter@students.cvtech.edu',       password: 'dCScBx3', role: 'user',  group: 'pm' },
  { username: 'Mason_DeSpain',         email: 'mason.despain@students.cvtech.edu',         password: 'Jq43FUj', role: 'user',  group: 'pm' },
  { username: 'Cale_Hansing',          email: 'cale.hansing@students.cvtech.edu',          password: '3h2sVP4', role: 'user',  group: 'pm' },
  { username: 'Taitum_Higdon',         email: 'taitum.higdon@students.cvtech.edu',         password: 'KG7SM58', role: 'user',  group: 'pm' },
  { username: 'Cameron_Hill',          email: 'cameron.hill@students.cvtech.edu',          password: '7WMpUtb', role: 'user',  group: 'pm' },
  { username: 'Campbell_Hill',         email: 'campbell.hill@student.cvtech.edu',          password: 'BnjPsnj', role: 'user',  group: 'pm' },
  { username: 'Noah_Neaves',           email: 'noah.neaves@students.cvtech.edu',           password: 'FbQPTKU', role: 'user',  group: 'pm' },
  { username: 'Michael_Patterson',     email: 'michael.patterson@students.cvtech.edu',     password: 'sae8gM4', role: 'user',  group: 'pm' },
  { username: 'Devon_Richardson',      email: 'devon.richardson@students.cvtech.edu',      password: 'hLpfBkH', role: 'user',  group: 'pm' },
  { username: 'Christain_Sanchez',     email: 'christain.sanchez@students.cvtech.edu',     password: 'GCPbrdj', role: 'user',  group: 'pm' },
  { username: 'Gavin_Satten',          email: 'gavin.satten@students.cvtech.edu',          password: '9VyRJgr', role: 'user',  group: 'pm' },
  { username: 'Nathan_Washam',         email: 'nathan.washam@students.cvtech.edu',         password: 'TZLBaNa', role: 'user',  group: 'pm' },
  { username: 'Jackson_Zuelsdorf',     email: 'jackson.zuelsdorf@students.cvtech.edu',     password: 'kppJMa5', role: 'user',  group: 'pm' },
  { username: 'Iestin_Lane',           email: 'iestin.lane@students.cvtech.edu',           password: 'YCHBUsN', role: 'user',  group: 'pm' },

  // ── AM ────────────────────────────────────────────────────────────────────
  { username: 'Carsen_Renegar',        email: 'carsen.renegar@students.cvtech.edu',        password: 'pMk3cEq', role: 'admin', group: 'am' },

  { username: 'Simeon_Angelov',        email: 'simeon.angelov@students.cvtech.edu',        password: '5kU9Hqe', role: 'user',  group: 'am' },
  { username: 'Zayden_Arney',          email: 'zayden.arney@students.cvtech.edu',          password: 'Cj3Yngg', role: 'user',  group: 'am' },
  { username: 'Isaiah_Boice',          email: 'isaiah.boice@students.cvtech.edu',          password: 'RDw3hnK', role: 'user',  group: 'am' },
  { username: 'Mai_Brouhard',          email: 'mai.brouhard@students.cvtech.edu',          password: 'MPPJNaV', role: 'user',  group: 'am' },
  { username: 'Rylen_Chamberlain',     email: 'rylen.chamberlain@students.cvtech.edu',     password: '5LUKAkT', role: 'user',  group: 'am' },
  { username: 'Alyssa_Deakins',        email: 'alyssa.deakins@students.cvtech.edu',        password: 'PttYVzk', role: 'user',  group: 'am' },
  { username: 'Jacob_Faerber',         email: 'jacob.faerber@students.cvtech.edu',         password: '9qka4hf', role: 'user',  group: 'am' },
  { username: 'Robert_Genzler',        email: 'robert.genzler@students.cvtech.edu',        password: 'jnp3Tt4', role: 'user',  group: 'am' },
  { username: 'Huy_Huynh',             email: 'huy.huynh@students.cvtech.edu',             password: 'mF6S3Kz', role: 'user',  group: 'am' },
  { username: 'Devon_James',           email: 'devon.james@students.cvtech.edu',           password: 'VJCKjHV', role: 'user',  group: 'am' },
  { username: 'Luke_Labus',            email: 'luke.labus@students.cvtech.edu',            password: '8kEJuR3', role: 'user',  group: 'am' },
  { username: 'Eric_Pouncy',           email: 'eric.pouncy@students.cvtech.edu',           password: 'KpQLQxN', role: 'user',  group: 'am' },
  { username: 'Grant_Rayburn',         email: 'grant.rayburn@students.cvtech.edu',         password: 'FAtjjtg', role: 'user',  group: 'am' },
  { username: 'Cooper_Remy',           email: 'cooper.remy@students.cvtech.edu',           password: 'MRYxy8H', role: 'user',  group: 'am' },
  { username: 'Cole_Washington',       email: 'cole.washington@students.cvtech.edu',       password: 'HM6A2Yr', role: 'user',  group: 'am' },
  { username: 'Braxton_Wood',          email: 'braxton.wood@students.cvtech.edu',          password: 'ts4LZPW', role: 'user',  group: 'am' },

  // ── All Day ───────────────────────────────────────────────────────────────
  { username: 'Garrett_Hughey',        email: 'garrett.hughey@students.cvtech.edu',        password: 'QEyFst5', role: 'admin', group: 'allday' },
  { username: 'Bryceson_McDaniels',    email: 'bryceson.mcdaniels@students.cvtech.edu',    password: '3xuPkmZ', role: 'admin', group: 'allday' },
  { username: 'Jackson_Reeves',        email: 'jackson.reeves@students.cvtech.edu',        password: 'speVcwh', role: 'admin', group: 'allday' },

  { username: 'Kyra_Lindsey',          email: 'kyra.lindsey@students.cvtech.edu',          password: 'LAzWYdX', role: 'user',  group: 'allday' },
  { username: 'Gianna_Crawford',       email: 'gianna.crawford@students.cvtech.edu',       password: 'PMhJNne', role: 'user',  group: 'allday' },
  { username: 'Clarence_Woodberry',    email: 'clarence.woodberry@students.cvtech.edu',    password: 'MxLWF3S', role: 'user',  group: 'allday' },
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

      const created_user = await userService.createUser({
        username: u.username,
        email:    u.email,
        password: u.password,
        role:     u.role,
        mustChangePw: 1,
      });
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
