'use strict';
const db = require('../db/connection');

function getOverlapping(equipmentId, startDate, endDate, period, excludeId = null) {
  let periodClause = '';
  if (period === 'am') {
    periodClause = `AND (r.period IS NULL OR r.period = 'allday' OR r.period = 'am')`;
  } else if (period === 'pm') {
    periodClause = `AND (r.period IS NULL OR r.period = 'allday' OR r.period = 'pm')`;
  }
  const excludeClause = excludeId ? 'AND r.id != ?' : '';
  const params = [equipmentId, endDate, startDate];
  if (excludeId) params.push(parseInt(excludeId, 10));
  return db.prepare(`
    SELECT r.*, u.username
    FROM reservations r
    LEFT JOIN users u ON u.id = r.user_id
    WHERE r.equipment_id = ?
      AND r.status IN ('pending','active')
      AND r.start_date <= ?
      AND r.end_date >= ?
      ${periodClause}
      ${excludeClause}
    ORDER BY r.start_date
  `).all(...params);
}

function getAvailability(equipmentId, startDate, endDate, period = 'allday') {
  const item = db.prepare('SELECT * FROM equipment WHERE id = ?').get(equipmentId);
  if (!item) return { available: false, reason: 'Item not found' };
  if (item.status === 'damaged' || item.status === 'needs_repair') {
    return { available: false, reason: `Item is ${item.status.replace('_', ' ')}` };
  }
  const conflicts = getOverlapping(equipmentId, startDate, endDate, period);
  const qty = item.quantity || 1;
  if (conflicts.length >= qty) {
    return { available: false, reason: 'Already reserved for that period', conflicts };
  }
  return { available: true, conflicts };
}

function createReservation(equipmentId, userId, startDate, endDate, period = 'allday', notes = '') {
  const avail = getAvailability(equipmentId, startDate, endDate, period);
  if (!avail.available) throw Object.assign(new Error(avail.reason), { status: 409 });

  const result = db.prepare(`
    INSERT INTO reservations (equipment_id, user_id, start_date, end_date, period, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(equipmentId, userId, startDate, endDate, period || 'allday', notes);

  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
  const eq = db.prepare('SELECT status FROM equipment WHERE id = ?').get(equipmentId);
  db.prepare(`
    INSERT INTO checkout_log
      (equipment_id, action, performed_by, checkout_user, notes, status_before, status_after)
    VALUES (?, 'reserved', ?, ?, ?, ?, ?)
  `).run(equipmentId, userId, user?.username || '', notes, eq?.status || 'available', eq?.status || 'available');

  return db.prepare('SELECT * FROM reservations WHERE id = ?').get(result.lastInsertRowid);
}

function cancelReservation(reservationId, actingUser) {
  const res = db.prepare('SELECT * FROM reservations WHERE id = ?').get(reservationId);
  if (!res) throw Object.assign(new Error('Reservation not found'), { status: 404 });
  if (res.user_id !== actingUser.id && !['admin', 'owner'].includes(actingUser.role)) {
    throw Object.assign(new Error('Not authorized'), { status: 403 });
  }
  db.prepare(`
    UPDATE reservations SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?
  `).run(reservationId);

  const eq = db.prepare('SELECT status FROM equipment WHERE id = ?').get(res.equipment_id);
  db.prepare(`
    INSERT INTO checkout_log
      (equipment_id, action, performed_by, checkout_user, notes, status_before, status_after)
    VALUES (?, 'reservation_cancelled', ?, ?, ?, ?, ?)
  `).run(
    res.equipment_id,
    actingUser.id, actingUser.username,
    `Reservation #${reservationId} cancelled`,
    eq?.status || 'available', eq?.status || 'available'
  );

  return res;
}

function getForEquipment(equipmentId) {
  return db.prepare(`
    SELECT r.*, u.username
    FROM reservations r
    LEFT JOIN users u ON u.id = r.user_id
    WHERE r.equipment_id = ? AND r.status IN ('pending','active')
    ORDER BY r.start_date
  `).all(equipmentId);
}

function getForUser(userId) {
  return db.prepare(`
    SELECT r.*, e.name AS equipment_name, e.barcode
    FROM reservations r
    JOIN equipment e ON e.id = r.equipment_id
    WHERE r.user_id = ? AND r.status IN ('pending','active')
    ORDER BY r.start_date
  `).all(userId);
}

function getAll({ status = null } = {}) {
  const where = status ? `WHERE r.status = ?` : '';
  const params = status ? [status] : [];
  return db.prepare(`
    SELECT r.*, u.username, e.name AS equipment_name, e.barcode
    FROM reservations r
    LEFT JOIN users u ON u.id = r.user_id
    LEFT JOIN equipment e ON e.id = r.equipment_id
    ${where}
    ORDER BY r.start_date DESC
    LIMIT 200
  `).all(...params);
}

function runReservationCron() {
  const today = new Date().toISOString().slice(0, 10);

  // Activate pending reservations whose start_date is today
  const activated = db.prepare(`
    UPDATE reservations SET status = 'active', updated_at = datetime('now')
    WHERE status = 'pending' AND start_date <= ?
  `).run(today);

  // Fulfil active reservations whose end_date has passed
  db.prepare(`
    UPDATE reservations SET status = 'fulfilled', updated_at = datetime('now')
    WHERE status = 'active' AND end_date < ?
  `).run(today);

  // Notify users whose reservations go active today
  if (activated.changes > 0) {
    const activeToday = db.prepare(`
      SELECT r.*, u.email, u.username, e.name AS equipment_name, e.barcode,
             e.status AS equipment_status, e.checked_out_by
      FROM reservations r
      JOIN users u ON u.id = r.user_id
      JOIN equipment e ON e.id = r.equipment_id
      WHERE r.status = 'active' AND r.start_date = ?
    `).all(today);

    const emailService = require('./emailService');
    const userService = require('./userService');
    const admins = userService.getAdmins();

    for (const res of activeToday) {
      const item = { name: res.equipment_name, barcode: res.barcode, status: res.equipment_status };
      const user = { email: res.email, username: res.username };
      emailService.sendReservationActive(res, item, user).catch(() => {});

      // If item is still checked out, alert admin + remind borrower
      if (res.equipment_status === 'checked_out' && res.checked_out_by) {
        const borrower = db.prepare('SELECT * FROM users WHERE id = ?').get(res.checked_out_by);
        if (borrower) {
          emailService.sendReservationConflictAdmin(res, item, borrower.username, admins).catch(() => {});
          emailService.sendReservationConflictBorrower(item, borrower, res.start_date).catch(() => {});
        }
      }
    }
  }
}

module.exports = {
  getAvailability,
  createReservation,
  cancelReservation,
  getForEquipment,
  getForUser,
  getAll,
  runReservationCron,
};
