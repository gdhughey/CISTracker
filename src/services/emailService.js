'use strict';
const { Resend } = require('resend');
const config = require('../config');

const esc = (s) => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let client = null;
function getClient() {
  if (!client && config.resend.apiKey) client = new Resend(config.resend.apiKey);
  return client;
}

// Shared HTML wrapper — dark card matching CISTracker branding.
function wrap(content) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#1a1d27;border-radius:8px;overflow:hidden;max-width:560px;width:100%;">
        <tr><td style="padding:24px 32px;border-bottom:1px solid #2a2d3a;">
          <span style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">CISTracker</span>
        </td></tr>
        <tr><td style="padding:32px;color:#d1d5db;font-size:15px;line-height:1.6;">
          ${content}
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #2a2d3a;font-size:12px;color:#6b7280;">
          CISTracker &middot; cistracker.net &middot; This is an automated message, please do not reply.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function send({ to, subject, html, cc }) {
  const resend = getClient();
  if (!resend) {
    console.warn('[email] RESEND_API_KEY not set — skipping email to', to);
    return;
  }
  try {
    const payload = { from: config.resend.from, to, subject, html };
    if (cc && cc.length) payload.cc = cc;
    await resend.emails.send(payload);
  } catch (err) {
    console.warn('[email] Failed to send to', to, '—', err.message);
  }
}

// Admin created an account — send username + temp password.
async function sendWelcome(user, tempPassword) {
  await send({
    to: user.email,
    subject: 'Your CISTracker account is ready',
    html: wrap(`
      <p>Hi <strong style="color:#fff;">${esc(user.username)}</strong>,</p>
      <p>An admin has created a CISTracker account for you. Here are your login details:</p>
      <table cellpadding="0" cellspacing="0" style="background:#0f1117;border-radius:6px;padding:16px 20px;margin:20px 0;width:100%;box-sizing:border-box;">
        <tr><td style="color:#9ca3af;font-size:13px;padding-bottom:4px;">Username</td></tr>
        <tr><td style="color:#fff;font-family:monospace;font-size:16px;padding-bottom:12px;">${esc(user.username)}</td></tr>
        <tr><td style="color:#9ca3af;font-size:13px;padding-bottom:4px;">Temporary Password</td></tr>
        <tr><td style="color:#fff;font-family:monospace;font-size:16px;">${esc(tempPassword)}</td></tr>
      </table>
      <p>You will be asked to set a new password when you first sign in.</p>
      <p><a href="${config.appUrl}" style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;">Sign In</a></p>
      <p style="color:#6b7280;font-size:13px;">If you weren't expecting this email, please contact your administrator.</p>
    `),
  });
}

// User requested a password reset — send the one-time link.
async function sendPasswordReset(user, resetUrl) {
  await send({
    to: user.email,
    subject: 'Reset your CISTracker password',
    html: wrap(`
      <p>Hi <strong style="color:#fff;">${user.username}</strong>,</p>
      <p>We received a request to reset your CISTracker password. Click the button below to set a new password. This link expires in <strong style="color:#fff;">1 hour</strong>.</p>
      <p style="margin:24px 0;">
        <a href="${resetUrl}" style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;">Reset Password</a>
      </p>
      <p style="color:#6b7280;font-size:13px;">If you didn't request a password reset, you can safely ignore this email — your password will not change.</p>
    `),
  });
}

// Admin changed a user's email address — notify the new address.
async function sendEmailChanged(newEmail, username) {
  await send({
    to: newEmail,
    subject: 'Your CISTracker email was updated',
    html: wrap(`
      <p>Hi <strong style="color:#fff;">${username}</strong>,</p>
      <p>This is a confirmation that your CISTracker account email address has been updated to <strong style="color:#fff;">${newEmail}</strong>.</p>
      <p style="color:#6b7280;font-size:13px;">If you didn't make this change, please contact your administrator immediately.</p>
    `),
  });
}

// Item checked in — notify the next person waiting in the queue.
async function sendQueueNotification(user, equipmentName) {
  await send({
    to: user.email,
    cc: config.resend.adminEmails,
    subject: 'Your waitlisted item is now available',
    html: wrap(`
      <p>Hi <strong style="color:#fff;">${user.username}</strong>,</p>
      <p>Good news! An item you were waiting for is now available:</p>
      <p style="background:#0f1117;border-radius:6px;padding:14px 18px;font-size:16px;color:#fff;margin:20px 0;">${equipmentName}</p>
      <p>Head to the lab to check it out before someone else does.</p>
      <p><a href="${config.appUrl}" style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;">Go to CISTracker</a></p>
    `),
  });
}

// Daily cron — student has overdue items.
// items: array of equipment rows with days_out field.
async function sendOverdueReminder(user, items) {
  const rows = items.map(i =>
    `<tr>
      <td style="padding:8px 0;color:#fff;border-bottom:1px solid #2a2d3a;">${i.name}</td>
      <td style="padding:8px 0;color:#ef4444;text-align:right;border-bottom:1px solid #2a2d3a;white-space:nowrap;">${i.days_overdue} day${i.days_overdue === 1 ? '' : 's'} overdue</td>
    </tr>`
  ).join('');
  await send({
    to: user.email,
    subject: 'You have overdue equipment',
    html: wrap(`
      <p>Hi <strong style="color:#fff;">${user.username}</strong>,</p>
      <p>You have equipment that is past its due date. Please return the following item${items.length > 1 ? 's' : ''} as soon as possible:</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
        <tr>
          <th style="text-align:left;color:#9ca3af;font-size:12px;font-weight:600;padding-bottom:8px;border-bottom:1px solid #2a2d3a;">Item</th>
          <th style="text-align:right;color:#9ca3af;font-size:12px;font-weight:600;padding-bottom:8px;border-bottom:1px solid #2a2d3a;">Status</th>
        </tr>
        ${rows}
      </table>
      <p>Return equipment to the lab during open hours. If you have questions, contact your administrator.</p>
    `),
  });
}

// Student submitted a ticket — send confirmation.
async function sendTicketConfirmation(user, ticket) {
  const desc = ticket.description
    ? `<tr><td style="color:#9ca3af;font-size:13px;padding-top:8px;">${ticket.description.slice(0, 200)}${ticket.description.length > 200 ? '&hellip;' : ''}</td></tr>`
    : '';
  await send({
    to: user.email,
    cc: config.resend.adminEmails,
    subject: `We received your support ticket #${ticket.id}`,
    html: wrap(`
      <p>Hi <strong style="color:#fff;">${user.username}</strong>,</p>
      <p>We received your support ticket and will get back to you as soon as possible.</p>
      <table cellpadding="0" cellspacing="0" style="background:#0f1117;border-radius:6px;padding:16px 20px;margin:20px 0;width:100%;box-sizing:border-box;">
        <tr><td style="color:#9ca3af;font-size:12px;padding-bottom:4px;">Ticket #${ticket.id}</td></tr>
        <tr><td style="color:#fff;font-size:15px;font-weight:600;padding-bottom:4px;">${ticket.subject}</td></tr>
        ${desc}
      </table>
      <p style="color:#6b7280;font-size:13px;">You will receive an email when the status of your ticket changes.</p>
    `),
  });
}

// Admin updated ticket status — notify the reporter.
async function sendTicketStatusUpdate(user, ticket) {
  const statusLabels = { open: 'Open', in_progress: 'In Progress', resolved: 'Resolved', closed: 'Closed' };
  const statusColors = { open: '#3b82f6', in_progress: '#f59e0b', resolved: '#10b981', closed: '#6b7280' };
  const label = statusLabels[ticket.status] || ticket.status;
  const color = statusColors[ticket.status] || '#6b7280';
  await send({
    to: user.email,
    cc: config.resend.adminEmails,
    subject: `Your ticket #${ticket.id} has been updated`,
    html: wrap(`
      <p>Hi <strong style="color:#fff;">${user.username}</strong>,</p>
      <p>Your support ticket has been updated.</p>
      <table cellpadding="0" cellspacing="0" style="background:#0f1117;border-radius:6px;padding:16px 20px;margin:20px 0;width:100%;box-sizing:border-box;">
        <tr><td style="color:#9ca3af;font-size:12px;padding-bottom:4px;">Ticket #${ticket.id}</td></tr>
        <tr><td style="color:#fff;font-size:15px;font-weight:600;padding-bottom:8px;">${ticket.subject}</td></tr>
        <tr><td><span style="background:${color};color:#fff;font-size:12px;font-weight:600;padding:3px 10px;border-radius:99px;">${label}</span></td></tr>
      </table>
      <p><a href="${config.appUrl}" style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;">View Ticket</a></p>
    `),
  });
}

module.exports = {
  sendWelcome,
  sendPasswordReset,
  sendEmailChanged,
  sendQueueNotification,
  sendOverdueReminder,
  sendTicketConfirmation,
  sendTicketStatusUpdate,
};
