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

async function sendPasswordReset(to, resetUrl) {
  return send({
    to,
    subject: 'CyberLab password reset',
    text: `A password reset was requested for your CyberLab account.\n\nReset link (valid 1 hour):\n${resetUrl}\n\nIf you did not request this, ignore this email.`,
  });
}

async function sendOverdueReminder(to, equipmentName, daysOverdue) {
  return send({
    to,
    subject: `Reminder: ${equipmentName} is ${daysOverdue} days overdue`,
    text: `You have ${equipmentName} checked out and it is now ${daysOverdue} days overdue. Please return it to the CyberLab.`,
  });
}

async function sendOverdueAlert(to, username, equipmentName, daysOverdue) {
  return send({
    to,
    subject: `ALERT: ${equipmentName} ${daysOverdue} days overdue (${username})`,
    text: `User ${username} has had ${equipmentName} checked out for ${daysOverdue} days. Please follow up.`,
  });
}

module.exports = { send, sendPasswordReset, sendOverdueReminder, sendOverdueAlert };
