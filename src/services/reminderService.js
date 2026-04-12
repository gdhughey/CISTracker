'use strict';
const cron = require('node-cron');
const config = require('../config');
const equipmentService = require('./equipmentService');
const emailService = require('./emailService');
const db = require('../db/connection');

function getAdminEmails() {
  return db.prepare("SELECT email FROM users WHERE role = 'admin' AND email != ''").all().map((r) => r.email);
}

async function runOverdueCheck() {
  if (!emailService.isConfigured()) {
    console.log('[reminders] SMTP not configured — skipping overdue check');
    return;
  }
  console.log('[reminders] running overdue check...');

  // 3+ day overdue → email the student
  const reminderItems = equipmentService.getOverdue(config.reminders.reminderDays);
  // Group by user
  const byUser = {};
  for (const item of reminderItems) {
    const key = item.checked_out_by;
    if (!byUser[key]) byUser[key] = { email: item.checked_out_email, username: item.checked_out_username, items: [] };
    byUser[key].items.push(item);
  }
  let studentCount = 0;
  for (const u of Object.values(byUser)) {
    if (!u.email) continue;
    await emailService.sendOverdueReminder(u.email, u.username, u.items);
    studentCount++;
  }
  if (studentCount) console.log(`[reminders] sent overdue reminders to ${studentCount} student(s)`);

  // 5+ day overdue → alert all admins
  const alertItems = equipmentService.getOverdue(config.reminders.alertDays);
  if (alertItems.length) {
    const adminEmails = getAdminEmails();
    for (const email of adminEmails) {
      await emailService.sendAdminAlert(email, alertItems);
    }
    if (adminEmails.length) console.log(`[reminders] sent 5-day alerts to ${adminEmails.length} admin(s)`);
  }
}

function start() {
  const expr = config.reminders.cron;
  if (!cron.validate(expr)) {
    console.error('[reminders] invalid cron expression:', expr);
    return;
  }
  console.log(`[reminders] scheduled overdue check: ${expr}`);
  cron.schedule(expr, () => {
    runOverdueCheck().catch((err) => console.error('[reminders] error:', err.message));
  });
}

module.exports = { start, runOverdueCheck };
