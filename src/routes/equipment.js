'use strict';
const express = require('express');
const QRCode = require('qrcode');
const { z } = require('zod');
const equipmentService = require('../services/equipmentService');
const equipmentUnitService = require('../services/equipmentUnitService');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { stripHtml } = require('../utils/sanitize');

const router = express.Router();

const createSchema = z.object({
  name:          z.string().min(1).max(200).transform(stripHtml),
  type:          z.string().max(100).optional().transform(v => stripHtml(v || '')),
  serial_number: z.string().max(100).optional().transform(v => stripHtml(v || '')),
  barcode:       z.string().max(100).optional().transform(v => stripHtml(v || '')),
  category:      z.string().max(100).optional().transform(v => stripHtml(v || '')),
  location:      z.string().max(200).optional().transform(v => stripHtml(v || '')),
  location_id:   z.number().int().positive().optional().nullable(),
  model_id:      z.number().int().positive().optional().nullable(),
  notes:         z.string().max(2000).optional().transform(v => stripHtml(v || '')),
  quantity:      z.number().int().min(1).max(10000).optional().default(1),
});

const updateSchema = createSchema.partial();

const checkoutSchema = z.object({
  notes: z.string().max(500).optional().transform(v => stripHtml(v || '')),
  source: z.enum(['Manual', 'Scan', 'Barcode']).optional(),
  // Admin kiosk: when an admin performs checkout on behalf of a student,
  // they pass the target user's id here. Non-admins must omit this — the
  // server enforces that below and falls back to the acting user.
  for_user_id: z.number().int().positive().optional(),
  // Checkout duration in days (1–30). Server calculates due_date from this.
  duration_days: z.number().int().min(1).max(30).optional().default(7),
});

router.use(requireAuth);

router.get('/', (req, res) => {
  try {
    const status = req.query.status;
    const items = equipmentService.listAll({ status });
    try {
      const queueService = require('../services/queueService');
      const queueLengths = queueService.allQueueLengths();
      for (const item of items) {
        item.queue_length = queueLengths.get(item.id) || 0;
      }
    } catch { /* queue table may not exist yet */ }
    res.json({ items });
  } catch { res.json({ items: [] }); }
});

// Full activity log is admin-only.
// Optionally filter by equipment_id (?equipment_id=123) so the detail
// panel can fetch history for one item without scanning the whole log.
router.get('/log', requireRole('admin'), (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const equipmentId = req.query.equipment_id ? parseInt(req.query.equipment_id, 10) : undefined;
  const userId      = req.query.user_id      ? parseInt(req.query.user_id, 10)      : undefined;
  res.json({ entries: equipmentService.getLog({ limit, equipmentId, userId }) });
});

router.delete('/log', requireRole('admin'), (req, res) => {
  equipmentService.clearLog();
  req.audit('clear_log', null);
  res.json({ ok: true });
});

// Suggest the next CIS-NNNNNN asset ID. Admin-only since adding inventory
// items is an admin task.
router.get('/next-asset-id', requireRole('admin'), (req, res) => {
  res.json({ asset_id: equipmentService.nextAssetId() });
});

// Look up an equipment row by its asset ID / barcode (or serial number).
// Used by the QR scan flow on Check Out / Check In so the client can show
// a confirmation card before mutating status.
router.get('/lookup', (req, res) => {
  const code = String(req.query.code || '').trim();
  if (!code) return res.status(400).json({ error: 'code is required' });
  const item = equipmentService.findByIdentifier({ barcode: code, serial_number: code });
  if (!item) return res.status(404).json({ error: 'No equipment matches that code' });
  res.json({ item });
});

// Render a printable QR label for an existing equipment row. The QR
// encodes the barcode/asset ID only — never a URL.
router.get('/:id(\\d+)/label', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const item = equipmentService.getById(id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    const code = (item.barcode || '').trim();
    if (!code) return res.status(400).json({ error: 'Item has no asset ID / barcode to encode' });
    const qr = await QRCode.toDataURL(code, {
      errorCorrectionLevel: 'M',
      margin: 1,
      scale: 8,
      color: { dark: '#000000', light: '#FFFFFF' },
    });
    res.json({ asset_id: code, name: item.name, qr_data_url: qr });
  } catch (err) { next(err); }
});

router.get('/:id(\\d+)', (req, res) => {
  const item = equipmentService.getById(parseInt(req.params.id, 10));
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json({ item });
});

router.post('/', requireRole('admin'), validate(createSchema), (req, res) => {
  const item = equipmentService.create(req.body);
  req.audit('equipment_create', String(item.id), { name: item.name });
  res.status(201).json({ item });
});

router.put('/:id(\\d+)', requireRole('admin'), validate(updateSchema), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const item = equipmentService.update(id, req.body);
  req.audit('equipment_update', String(id));
  res.json({ item });
});

router.delete('/:id(\\d+)', requireRole('admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  equipmentService.remove(id);
  req.audit('equipment_delete', String(id));
  res.json({ ok: true });
});

const batchCheckoutSchema = z.object({
  equipment_ids: z.array(z.number().int().positive()).min(1).max(50),
  notes: z.string().max(500).optional().transform(v => stripHtml(v || '')),
  for_user_id: z.number().int().positive().optional(),
  duration_days: z.number().int().min(1).max(30).optional().default(7),
});

router.post('/batch-checkout', validate(batchCheckoutSchema), (req, res, next) => {
  try {
    let borrower = { id: req.user.id, username: req.user.username };
    if (req.body.for_user_id && req.body.for_user_id !== req.user.id) {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can check out on behalf of another user' });
      }
      const target = require('../services/userService').getById(req.body.for_user_id);
      if (!target) return res.status(404).json({ error: 'Selected user not found' });
      borrower = { id: target.id, username: target.username };
    }
    const results = equipmentService.batchCheckout(
      req.body.equipment_ids,
      borrower.id,
      borrower.username,
      req.body.notes,
      'Manual',
      req.user.id,
      req.body.duration_days,
    );
    req.audit('batch_checkout', null, { count: results.filter(r => r.success).length, for_user: borrower.username });
    res.json({ results });
  } catch (err) { next(err); }
});

const batchCheckinSchema = z.object({
  equipment_ids: z.array(z.number().int().positive()).min(1).max(50),
  notes: z.string().max(500).optional().transform(v => stripHtml(v || '')),
});

router.post('/batch-checkin', requireRole('admin'), validate(batchCheckinSchema), (req, res, next) => {
  try {
    const results = equipmentService.batchCheckin(req.body.equipment_ids, req.user, req.body.notes || '');
    req.audit('batch_checkin', null, { count: results.filter(r => r.success).length });
    res.json({ results });
  } catch (err) { next(err); }
});

router.post('/:id(\\d+)/checkout', validate(checkoutSchema), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    // Resolve who the equipment is being checked out *to*. Admins can pass
    // for_user_id to check out on behalf of a student (kiosk flow). Anyone
    // else attempting to pass a different user id is rejected.
    let borrower = { id: req.user.id, username: req.user.username };
    if (req.body.for_user_id && req.body.for_user_id !== req.user.id) {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can check out on behalf of another user' });
      }
      const target = require('../services/userService').getById(req.body.for_user_id);
      if (!target) return res.status(404).json({ error: 'Selected user not found' });
      borrower = { id: target.id, username: target.username };
    }
    const item = equipmentService.checkout(
      id,
      borrower.id,
      borrower.username,
      req.body.notes,
      req.body.source,
      req.user.id,
      req.body.duration_days,
    );
    req.audit('checkout', String(id), borrower.id !== req.user.id ? { for_user: borrower.username } : undefined);
    res.json({ item });
  } catch (err) { next(err); }
});

router.post('/:id(\\d+)/checkin', validate(checkoutSchema), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const result = equipmentService.checkin(id, req.user, req.body.notes, req.body.source);
    req.audit('checkin', String(id));
    if (result.nextInQueue && result.nextInQueue.email) {
      const emailService = require('../services/emailService');
      emailService.sendQueueNotification(result.nextInQueue, result.item.name);
    }
    res.json({
      item: result.item,
      nextInQueue: result.nextInQueue ? { username: result.nextInQueue.username } : null,
    });
  } catch (err) { next(err); }
});

// ── Equipment Units (per-unit serial/barcode under a qty>1 parent) ──────────
const unitSchema = z.object({
  serial_number: z.string().max(200).optional().transform(v => stripHtml(v || '')),
  barcode:       z.string().max(200).optional().transform(v => stripHtml(v || '')),
  notes:         z.string().max(500).optional().transform(v => stripHtml(v || '')),
});

router.get('/:id(\\d+)/units', (req, res, next) => {
  try {
    const item = equipmentService.getById(parseInt(req.params.id, 10));
    if (!item) return res.status(404).json({ error: 'Equipment not found' });
    res.json({ units: equipmentUnitService.listByEquipment(item.id) });
  } catch (err) { next(err); }
});

router.post('/:id(\\d+)/units', requireRole('admin'), validate(unitSchema), (req, res, next) => {
  try {
    const item = equipmentService.getById(parseInt(req.params.id, 10));
    if (!item) return res.status(404).json({ error: 'Equipment not found' });
    const unit = equipmentUnitService.create(item.id, req.body);
    req.audit('unit_add', String(item.id), { serial: unit.serial_number });
    res.status(201).json({ unit });
  } catch (err) { next(err); }
});

router.put('/units/:uid(\\d+)', requireRole('admin'), validate(unitSchema), (req, res, next) => {
  try {
    const unit = equipmentUnitService.update(parseInt(req.params.uid, 10), req.body);
    req.audit('unit_update', String(unit.equipment_id));
    res.json({ unit });
  } catch (err) { next(err); }
});

router.delete('/units/:uid(\\d+)', requireRole('admin'), (req, res, next) => {
  try {
    equipmentUnitService.remove(parseInt(req.params.uid, 10));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
