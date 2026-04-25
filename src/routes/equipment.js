'use strict';
const express = require('express');
const QRCode = require('qrcode');
const { z } = require('zod');
const equipmentService = require('../services/equipmentService');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { stripHtml } = require('../utils/sanitize');

const router = express.Router();

const createSchema = z.object({
  name: z.string().min(1).max(200).transform(stripHtml),
  type: z.string().max(100).optional().transform(v => stripHtml(v || '')),
  serial_number: z.string().max(100).optional().transform(v => stripHtml(v || '')),
  barcode: z.string().max(100).optional().transform(v => stripHtml(v || '')),
  category: z.string().max(100).optional().transform(v => stripHtml(v || '')),
  notes: z.string().max(2000).optional().transform(v => stripHtml(v || '')),
});

const updateSchema = createSchema.partial();

const checkoutSchema = z.object({
  notes: z.string().max(500).optional().transform(v => stripHtml(v || '')),
  source: z.enum(['Manual', 'Scan', 'Barcode']).optional(),
});

router.use(requireAuth);

router.get('/', (req, res) => {
  const status = req.query.status;
  // Non-admins only see items they themselves checked out.
  // Admins see everything.
  const onlyUserId = req.user.role === 'admin' ? undefined : req.user.id;
  res.json({ items: equipmentService.listAll({ status, checkedOutBy: onlyUserId }) });
});

// Full activity log is admin-only.
router.get('/log', requireRole('admin'), (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  res.json({ entries: equipmentService.getLog({ limit }) });
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

router.post('/', validate(createSchema), (req, res) => {
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

router.post('/:id(\\d+)/checkout', validate(checkoutSchema), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const item = equipmentService.checkout(id, req.user.id, req.user.username, req.body.notes, req.body.source);
    req.audit('checkout', String(id));
    res.json({ item });
  } catch (err) { next(err); }
});

router.post('/:id(\\d+)/checkin', validate(checkoutSchema), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const item = equipmentService.checkin(id, req.user, req.body.notes, req.body.source);
    req.audit('checkin', String(id));
    res.json({ item });
  } catch (err) { next(err); }
});

module.exports = router;
