'use strict';
const config = require('../config');

let resendClient = null;

function getClient() {
  if (resendClient) return resendClient;
  if (!config.resend.apiKey) return null;
  const { Resend } = require('resend');
  resendClient = new Resend(config.resend.apiKey);
  return resendClient;
}

// ── Core send ──────────────────────────────────────────────────────────────────

async function send({ from, to, subject, text, html }) {
  const client = getClient();
  if (!client) {
    console.warn(`[email] Resend not configured, would have sent to ${to}: ${subject}`);
    return { skipped: true };
  }
  const result = await client.emails.send({
    from: from || config.resend.noReplyFrom,
    to: Array.isArray(to) ? to : [to],
    subject,
    text,
    html,
  });
  return result;
}

// ── Transactional emails (from noreply@) ────────────────────────────────────

async function sendPasswordReset(to, username, tempPassword) {
  return send({
    from: config.resend.noReplyFrom,
    to,
    subject: 'CISTracker: Your password has been reset',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#0f1117;color:#e8eaf0;padding:32px;border-radius:12px;">
        <h2 style="color:#4f8ef7;margin-bottom:16px;">Password Reset</h2>
        <p>Hi <strong>${username}</strong>,</p>
        <p>An admin has reset your CISTracker account password.</p>
        <p>Your temporary password is:</p>
        <p style="text-align:center;"><code style="font-size:18px;background:#171b26;color:#4f8ef7;padding:8px 16px;border-radius:8px;border:1px solid #252836;letter-spacing:0.05em">${tempPassword}</code></p>
        <p>You will be required to change this password on your next login.</p>
        <p style="text-align:center;margin-top:24px;">
          <a href="https://cistracker.net" style="display:inline-block;background:#4f8ef7;color:#fff;text-decoration:none;padding:10px 28px;border-radius:8px;font-weight:600;font-size:15px;">Log in to CISTracker</a>
        </p>
        <p style="color:#6b7280;font-size:12px;margin-top:24px;">&mdash; CISTracker</p>
      </div>
    `,
    text: `Hi ${username}, your CISTracker password has been reset. Temporary password: ${tempPassword} — You must change it on next login. https://cistracker.net`,
  });
}

// Notify a user that an admin updated the email on their account.
// Sent to the NEW address only (confirms the change reached the right inbox).
async function sendEmailChangedNotice(to, username) {
  return send({
    from: config.resend.noReplyFrom,
    to,
    subject: 'CISTracker: Email address updated',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#0f1117;color:#e8eaf0;padding:32px;border-radius:12px;">
        <h2 style="color:#4f8ef7;margin-bottom:16px;">Email Updated</h2>
        <p>Hi <strong>${username}</strong>,</p>
        <p>An admin has updated the email address on your CISTracker account. This address (<strong>${to}</strong>) is now where account notifications, password resets, and overdue reminders will be delivered.</p>
        <p style="text-align:center;margin-top:24px;">
          <a href="https://cistracker.net" style="display:inline-block;background:#4f8ef7;color:#fff;text-decoration:none;padding:10px 28px;border-radius:8px;font-weight:600;font-size:15px;">Log in to CISTracker</a>
        </p>
        <p style="color:#6b7280;font-size:12px;margin-top:24px;">If you weren't expecting this change, contact the CISTracker admin.</p>
        <p style="color:#6b7280;font-size:12px;margin-top:8px;">&mdash; CISTracker</p>
      </div>
    `,
    text: `Hi ${username}, your CISTracker account email was updated to ${to} by an admin. Log in: https://cistracker.net — If you weren't expecting this, contact the CISTracker admin.`,
  });
}

// Self-service forgot-password flow — emails a one-time reset link (NOT a temp password).
async function sendPasswordResetLink(to, username, resetUrl) {
  return send({
    from: config.resend.noReplyFrom,
    to,
    subject: 'CISTracker: Reset your password',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#0f1117;color:#e8eaf0;padding:32px;border-radius:12px;">
        <h2 style="color:#4f8ef7;margin-bottom:16px;">Reset Your Password</h2>
        <p>Hi <strong>${username}</strong>,</p>
        <p>We received a request to reset your CISTracker password. Click the button below to choose a new one. This link will expire in 1 hour.</p>
        <p style="text-align:center;margin-top:24px;">
          <a href="${resetUrl}" style="display:inline-block;background:#4f8ef7;color:#fff;text-decoration:none;padding:10px 28px;border-radius:8px;font-weight:600;font-size:15px;">Reset Password</a>
        </p>
        <p style="font-size:12px;color:#6b7280;margin-top:16px;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
        <p style="color:#6b7280;font-size:12px;margin-top:24px;">&mdash; CISTracker</p>
      </div>
    `,
    text: `Hi ${username}, click this link to reset your CISTracker password (expires in 1 hour): ${resetUrl}\n\nIf you didn't request this, ignore this email.`,
  });
}

async function sendNewAccount(to, username, tempPassword) {
  return send({
    from: config.resend.noReplyFrom,
    to,
    subject: 'CISTracker: Your account has been created',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#0f1117;color:#e8eaf0;padding:32px;border-radius:12px;">
        <h2 style="color:#4f8ef7;margin-bottom:16px;">Welcome to CISTracker</h2>
        <p>Hi <strong>${username}</strong>,</p>
        <p>An account has been created for you on CISTracker.</p>
        <p>Your temporary password is:</p>
        <p style="text-align:center;"><code style="font-size:18px;background:#171b26;color:#4f8ef7;padding:8px 16px;border-radius:8px;border:1px solid #252836;letter-spacing:0.05em">${tempPassword}</code></p>
        <p>You will be required to change this password on your first login.</p>
        <p style="text-align:center;margin-top:24px;">
          <a href="https://cistracker.net" style="display:inline-block;background:#4f8ef7;color:#fff;text-decoration:none;padding:10px 28px;border-radius:8px;font-weight:600;font-size:15px;">Log in to CISTracker</a>
        </p>
        <p style="color:#6b7280;font-size:12px;margin-top:24px;">&mdash; CISTracker</p>
      </div>
    `,
    text: `Hi ${username}, a CISTracker account was created for you. Temporary password: ${tempPassword} — You must change it on first login. https://cistracker.net`,
  });
}

async function sendOverdueReminder(to, username, items) {
  const itemList = items
    .map(i => `<li><strong>${i.name}</strong> &mdash; ${i.days_out} day(s)</li>`)
    .join('');
  return send({
    from: config.resend.noReplyFrom,
    to,
    subject: `CISTracker: ${items.length} item(s) overdue`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#0f1117;color:#e8eaf0;padding:32px;border-radius:12px;">
        <h2 style="color:#f87171;margin-bottom:16px;">Equipment Overdue</h2>
        <p>Hi <strong>${username}</strong>,</p>
        <p>The following equipment needs to be returned:</p>
        <ul style="padding-left:20px;">${itemList}</ul>
        <p>Please return these items as soon as possible.</p>
        <p style="text-align:center;margin-top:24px;">
          <a href="https://cistracker.net" style="display:inline-block;background:#f87171;color:#fff;text-decoration:none;padding:10px 28px;border-radius:8px;font-weight:600;font-size:15px;">Go to CISTracker</a>
        </p>
        <p style="color:#6b7280;font-size:12px;margin-top:24px;">&mdash; CISTracker</p>
      </div>
    `,
    text: `Hi ${username}, you have ${items.length} overdue item(s). Please return them. https://cistracker.net`,
  });
}

async function sendAdminAlert(to, overdueItems) {
  const rows = overdueItems
    .map(i => `<tr><td style="padding:6px 10px;border:1px solid #252836">${i.name}</td><td style="padding:6px 10px;border:1px solid #252836">${i.checked_out_username}</td><td style="padding:6px 10px;border:1px solid #252836">${i.days_out}d</td></tr>`)
    .join('');
  return send({
    from: config.resend.noReplyFrom,
    to,
    subject: `CISTracker Alert: ${overdueItems.length} item(s) overdue 5+ days`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#0f1117;color:#e8eaf0;padding:32px;border-radius:12px;">
        <h2 style="color:#f87171;margin-bottom:16px;">Overdue Equipment Alert</h2>
        <p>The following items have been checked out for <strong>5+ days</strong>:</p>
        <table style="border-collapse:collapse;font-size:14px;width:100%;margin:12px 0;">
          <thead><tr style="background:#171b26"><th style="padding:8px 10px;border:1px solid #252836;text-align:left">Equipment</th><th style="padding:8px 10px;border:1px solid #252836;text-align:left">Student</th><th style="padding:8px 10px;border:1px solid #252836;text-align:left">Overdue</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="color:#6b7280;font-size:12px;margin-top:24px;">&mdash; CISTracker</p>
      </div>
    `,
    text: `CISTracker: ${overdueItems.length} item(s) overdue 5+ days. Check the admin panel.`,
  });
}

// ── Queue notification ─────────────────────────────────────────────────────────

async function sendQueueNotification(to, username, equipmentName) {
  return send({
    from: config.resend.noReplyFrom,
    to,
    subject: `CISTracker: ${equipmentName} is available!`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#0f1117;color:#e8eaf0;padding:32px;border-radius:12px;">
        <h2 style="color:#34d399;margin-bottom:16px;">🎉 Your Turn!</h2>
        <p>Hi <strong>${username}</strong>,</p>
        <p><strong>${equipmentName}</strong> has been returned and you're next in the queue!</p>
        <p>Head to CISTracker to check it out before someone else does.</p>
        <p style="text-align:center;margin-top:24px;">
          <a href="https://cistracker.net" style="display:inline-block;background:#34d399;color:#0f1117;text-decoration:none;padding:10px 28px;border-radius:8px;font-weight:600;font-size:15px;">Check Out Now</a>
        </p>
        <p style="color:#6b7280;font-size:12px;margin-top:24px;">&mdash; CISTracker</p>
      </div>
    `,
    text: `Hi ${username}, ${equipmentName} is now available and you're next in the queue! Check it out on CISTracker: https://cistracker.net`,
  });
}

// Forwarded when an admin drops a ticket they had assigned to themselves
// WITHOUT resolving it. Sent to config.resend.droppedForwardTo so a
// fallback owner sees that the ticket is back in the unassigned pool.
async function sendTicketDropped(ticket, droppedByUsername) {
  if (!config.resend.droppedForwardTo) return { skipped: true };
  return send({
    from: config.resend.supportFrom,
    to: config.resend.droppedForwardTo,
    subject: `[CISTracker] Ticket #${ticket.id} dropped by ${droppedByUsername}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#0f1117;color:#e8eaf0;padding:32px;border-radius:12px;">
        <h2 style="color:#fbbf24;margin-bottom:16px;">⚠️ Ticket dropped without resolution</h2>
        <p><strong>${droppedByUsername}</strong> released ticket <strong>#${ticket.id}</strong> back to the unassigned pool.</p>
        <p><strong>Subject:</strong> ${ticket.subject}</p>
        <p><strong>Status:</strong> ${ticket.status} &middot; <strong>Priority:</strong> ${ticket.priority}</p>
        <hr style="border:none;border-top:1px solid #252836;margin:16px 0;">
        <p>${(ticket.description || '').replace(/\n/g, '<br>')}</p>
        <p style="text-align:center;margin-top:24px;">
          <a href="https://cistracker.net" style="display:inline-block;background:#4f8ef7;color:#fff;text-decoration:none;padding:10px 28px;border-radius:8px;font-weight:600;font-size:15px;">Open Ticket #${ticket.id}</a>
        </p>
        <p style="color:#6b7280;font-size:12px;margin-top:24px;">&mdash; CISTracker</p>
      </div>
    `,
    text: `Ticket #${ticket.id} ("${ticket.subject}") was dropped by ${droppedByUsername} without resolution. Status: ${ticket.status}. https://cistracker.net`,
  });
}

// ── Support ticket forwarding ──────────────────────────────────────────────────

async function sendSupportTicket(ticket, reporterUsername) {
  return send({
    from: config.resend.supportFrom,
    to: config.resend.supportForwardTo,
    subject: `[CISTracker Ticket #${ticket.id}] ${ticket.subject}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#0f1117;color:#e8eaf0;padding:32px;border-radius:12px;">
        <h2 style="color:#a78bfa;margin-bottom:16px;">New Support Ticket #${ticket.id}</h2>
        <p><strong>From:</strong> ${reporterUsername}</p>
        <p><strong>Priority:</strong> ${ticket.priority}</p>
        <p><strong>Subject:</strong> ${ticket.subject}</p>
        <hr style="border:none;border-top:1px solid #252836;margin:16px 0;">
        <p>${(ticket.description || '').replace(/\n/g, '<br>')}</p>
        <p style="color:#6b7280;font-size:12px;margin-top:24px;">&mdash; CISTracker</p>
      </div>
    `,
    text: `New ticket #${ticket.id} from ${reporterUsername}: ${ticket.subject}\n\n${ticket.description}`,
  });
}

function isConfigured() {
  return !!config.resend.apiKey;
}

module.exports = {
  send, isConfigured,
  sendPasswordReset, sendPasswordResetLink, sendNewAccount, sendOverdueReminder, sendAdminAlert,
  sendQueueNotification, sendSupportTicket, sendEmailChangedNotice, sendTicketDropped,
};
