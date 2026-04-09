'use strict';
const express = require('express');
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
  res.json({ items: equipmentService.listAll({ status }) });
});

router.get('/log', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  res.json({ entries: equipmentService.getLog({ limit }) });
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
