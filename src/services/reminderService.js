'use strict';
const cron = require('node-cron');
const db = require('../db/connection');
const emailService = require('./emailService');
const config = require('../config');

// Find all checked-out items where due_date has passed, grouped by borrower.
function getOverdueByUser() {
  const rows = db.prepare(`
    SELECT e.id, e.name,
           CAST((julianday('now') - julianday(e.due_date)) AS INTEGER) AS days_overdue,
           u.id AS user_id, u.username, u.email
    FROM equipment e
    JOIN users u ON u.id = e.checked_out_by
    WHERE e.status = 'checked_out'
      AND e.due_date IS NOT NULL
      AND e.due_date < date('now')
    ORDER BY u.id, days_overdue DESC
  `).all();

  // Group items by user.
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.user_id)) {
      map.set(row.user_id, {
        user: { id: row.user_id, username: row.username, email: row.email },
        items: [],
      });
    }
    map.get(row.user_id).items.push({ id: row.id, name: row.name, days_overdue: row.days_overdue });
  }
  return [...map.values()];
}

async function runOverdueReminders() {
  try {
    const groups = getOverdueByUser();
    for (const { user, items } of groups) {
      if (user.email) {
        await emailService.sendOverdueReminder(user, items);
      }
    }
    if (groups.length > 0) {
      console.log(`[reminder] Sent overdue reminders to ${groups.length} student(s)`);
    }
  } catch (err) {
    console.warn('[reminder] Failed to run overdue reminders:', err.message);
  }
}

const hour = config.resend.overdueHour;
cron.schedule(`0 ${hour} * * *`, runOverdueReminders);
console.log(`[reminder] Overdue reminder cron scheduled at ${hour}:00 daily`);

module.exports = { runOverdueReminders };
