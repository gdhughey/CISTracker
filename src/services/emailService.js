'use strict';
const nodemailer = require('nodemailer');
const config = require('../config');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!config.smtp.host || !config.smtp.user) {
    return null;
  }
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });
  return transporter;
}

async function send({ to, subject, text, html }) {
  const t = getTransporter();
  if (!t) {
    // eslint-disable-next-line no-console
    console.warn(`[email] SMTP not configured, would have sent to ${to}: ${subject}`);
    return { skipped: true };
  }
  return t.sendMail({
    from: config.smtp.from,
    to,
    subject,
    text,
    html,
  });
}

async function sendPasswordReset(to, username, tempPassword) {
  return send({
    to,
    subject: 'CIS Lab: Your password has been reset',
    html: `
      <h2>Password Reset</h2>
      <p>Hi <strong>${username}</strong>,</p>
      <p>An admin has reset your CIS Lab account password.</p>
      <p>Your temporary password is: <code style="font-size:16px;background:#1e293b;color:#38bdf8;padding:4px 10px;border-radius:4px">${tempPassword}</code></p>
      <p>You will be required to change this password on your next login.</p>
      <p style="color:#888;font-size:12px">&mdash; CIS Equipment Tracker</p>
    `,
    text: `Hi ${username}, your CIS Lab password has been reset. Temporary password: ${tempPassword}  — You must change it on next login.`,
  });
}

async function sendNewAccount(to, username, tempPassword) {
  return send({
    to,
    subject: 'CIS Lab: Your account has been created',
    html: `
      <h2>Welcome to CIS Lab</h2>
      <p>Hi <strong>${username}</strong>,</p>
      <p>An account has been created for you on the CIS Equipment Tracker.</p>
      <p>Your temporary password is: <code style="font-size:16px;background:#1e293b;color:#38bdf8;padding:4px 10px;border-radius:4px">${tempPassword}</code></p>
      <p>You will be required to change this password on your first login.</p>
      <p style="color:#888;font-size:12px">&mdash; CIS Equipment Tracker</p>
    `,
    text: `Hi ${username}, a CIS Lab account was created for you. Temporary password: ${tempPassword}  — You must change it on first login.`,
  });
}

async function sendOverdueReminder(to, username, items) {
  const itemList = items
    .map((i) => `<li><strong>${i.name}</strong> &mdash; ${i.days_out} day(s), checked out ${new Date(i.checked_out_at).toLocaleDateString()}</li>`)
    .join('');
  return send({
    to,
    subject: `CIS Lab: ${items.length} item(s) overdue`,
    html: `
      <h2>Equipment Overdue Reminder</h2>
      <p>Hi <strong>${username}</strong>,</p>
      <p>The following equipment needs to be returned:</p>
      <ul>${itemList}</ul>
      <p>Please return these items to the CIS Lab as soon as possible.</p>
      <p style="color:#888;font-size:12px">&mdash; CIS Equipment Tracker</p>
    `,
    text: `Hi ${username}, you have ${items.length} overdue item(s). Please return them to the CIS Lab.`,
  });
}

async function sendAdminAlert(to, overdueItems) {
  const rows = overdueItems
    .map((i) => `<tr><td style="padding:4px 8px;border:1px solid #334155">${i.name}</td><td style="padding:4px 8px;border:1px solid #334155">${i.checked_out_username}</td><td style="padding:4px 8px;border:1px solid #334155">${i.days_out} days</td></tr>`)
    .join('');
  return send({
    to,
    subject: `CIS Lab Alert: ${overdueItems.length} item(s) overdue 5+ days`,
    html: `
      <h2>Overdue Equipment Alert</h2>
      <p>The following items have been checked out for <strong>5+ days</strong>:</p>
      <table style="border-collapse:collapse;font-size:14px;">
        <thead><tr style="background:#1e293b;color:#e2e8f0"><th style="padding:6px 8px;border:1px solid #334155">Equipment</th><th style="padding:6px 8px;border:1px solid #334155">Student</th><th style="padding:6px 8px;border:1px solid #334155">Overdue</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="color:#888;font-size:12px">&mdash; CIS Equipment Tracker</p>
    `,
    text: `CIS Lab: ${overdueItems.length} item(s) overdue 5+ days. Check the admin panel.`,
  });
}

function isConfigured() {
  return !!(config.smtp.host && config.smtp.user && config.smtp.pass);
}

module.exports = { send, isConfigured, sendPasswordReset, sendNewAccount, sendOverdueReminder, sendAdminAlert };
