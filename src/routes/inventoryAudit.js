'use strict';
const express = require('express');
const { z } = require('zod');
const inventoryAuditService = require('../services/inventoryAuditService');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { stripHtml } = require('../utils/sanitize');

const router = express.Router();
router.use(requireAuth);

const entrySchema = z.object({
  model_id:    z.number().int().positive().optional().nullable(),
  category_id: z.number().int().positive().optional().nullable(),
  item_name:   z.string().min(1).max(200).transform(v => stripHtml(v)),
  counted_qty: z.number().int().min(0),
  notes:       z.string().max(500).optional().transform(v => stripHtml(v || '')),
});

router.get('/', (req, res) => {
  const userId = req.user.role === 'admin' ? undefined : req.user.id;
  res.json({ audits: inventoryAuditService.listAll(userId) });
});

router.get('/:id(\\d+)', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const audit = inventoryAuditService.getById(id);
  if (!audit) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && audit.created_by !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const entries = inventoryAuditService.getEntries(id);
  res.json({ audit, entries });
});

router.post('/', (req, res) => {
  const notes = stripHtml((req.body?.notes || '').slice(0, 500));
  const audit = inventoryAuditService.create(req.user.id, notes);
  req.audit('inventory_audit_create', String(audit.id));
  res.status(201).json({ audit });
});

router.post('/:id(\\d+)/entries', validate(entrySchema), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const audit = inventoryAuditService.getById(id);
  if (!audit) return res.status(404).json({ error: 'Not found' });
  if (audit.status === 'closed') return res.status(409).json({ error: 'Audit is closed' });
  if (req.user.role !== 'admin' && audit.created_by !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const entry = inventoryAuditService.addEntry(id, req.body);
  res.status(201).json({ entry });
});

router.post('/:id(\\d+)/close', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const audit = inventoryAuditService.getById(id);
  if (!audit) return res.status(404).json({ error: 'Not found' });
  if (audit.status === 'closed') return res.status(409).json({ error: 'Already closed' });
  if (req.user.role !== 'admin' && audit.created_by !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const closed = inventoryAuditService.closeAudit(id);
  req.audit('inventory_audit_close', String(id));
  res.json({ audit: closed });
});

module.exports = router;
