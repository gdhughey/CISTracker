'use strict';
const cron = require('node-cron');
const db = require('../db/connection');

function getSettings() {
  let row = db.prepare('SELECT * FROM period_settings WHERE id = 1').get();
  if (!row) {
    db.prepare('INSERT OR IGNORE INTO period_settings (id) VALUES (1)').run();
    row = db.prepare('SELECT * FROM period_settings WHERE id = 1').get();
  }
  return row;
}

function updateSettings(body) {
  const { am_end_time, pm_end_time, timezone, school_days } = body;
  db.prepare(`
    UPDATE period_settings
    SET am_end_time = ?, pm_end_time = ?, timezone = ?, school_days = ?,
        updated_at = datetime('now')
    WHERE id = 1
  `).run(am_end_time, pm_end_time, timezone, school_days);
  reschedule();
}

function autoReturnPeriod(period) {
  const today = new Date().toISOString().slice(0, 10);
  const items = db.prepare(`
    SELECT r.equipment_id
    FROM reservations r
    JOIN equipment e ON e.id = r.equipment_id
    WHERE r.period = ? AND r.end_date = ? AND e.status = 'checked_out'
  `).all(period, today);

  for (const item of items) {
    db.prepare(`
      UPDATE equipment
      SET status = 'available', checked_out_by = NULL,
          checked_out_at = NULL, due_date = NULL, updated_at = datetime('now')
      WHERE id = ? AND status = 'checked_out'
    `).run(item.equipment_id);
    db.prepare(`
      INSERT INTO checkout_log (equipment_id, action, notes, source)
      VALUES (?, 'checkin', ?, 'System')
    `).run(item.equipment_id, `Auto-returned after ${period.toUpperCase()} period`);
  }

  if (items.length > 0) {
    console.log(`[period] Auto-returned ${items.length} item(s) after ${period.toUpperCase()} period`);
  }
}

let amTask = null;
let pmTask = null;

function parseCron(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return `${m} ${h} * * *`;
}

function reschedule() {
  if (amTask) { amTask.stop(); amTask = null; }
  if (pmTask) { pmTask.stop(); pmTask = null; }
  try {
    const s = getSettings();
    amTask = cron.schedule(parseCron(s.am_end_time), () => autoReturnPeriod('am'));
    pmTask = cron.schedule(parseCron(s.pm_end_time), () => autoReturnPeriod('pm'));
    console.log(`[period] Auto-return scheduled: AM @ ${s.am_end_time}, PM @ ${s.pm_end_time}`);
  } catch (err) {
    console.warn('[period] Failed to schedule auto-returns:', err.message);
  }
}

function scheduleAutoReturns() {
  reschedule();
}

module.exports = { scheduleAutoReturns, getSettings, updateSettings };
