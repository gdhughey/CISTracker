'use strict';
const express = require('express');
const { z } = require('zod');
const serviceTicketService = require('../services/serviceTicketService');
const equipmentService = require('../services/equipmentService');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { stripHtml } = require('../utils/sanitize');

const router = express.Router();
router.use(requireAuth);

const createSchema = z.object({
  type:    z.enum(['add_item', 'quantity_change', 'other']),
  payload: z.record(z.unknown()),
});

const resolveSchema = z.object({
  admin_notes: z.string().max(1000).optional().transform(v => stripHtml(v || '')),
});

router.get('/', (req, res) => {
  const status = req.query.status || undefined;
  let tickets = serviceTicketService.listAll({ status });
  if (req.user.role !== 'admin') {
    tickets = tickets.filter(t => t.requested_by === req.user.id);
  }
  res.json({ tickets });
});

router.get('/counts', requireRole('admin'), (_req, res) => {
  res.json({ pending: serviceTicketService.pendingCount() });
});

router.get('/:id(\\d+)', (req, res) => {
  const ticket = serviceTicketService.getById(parseInt(req.params.id, 10));
  if (!ticket) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && ticket.requested_by !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json({ ticket });
});

router.post('/', validate(createSchema), (req, res) => {
  const rawPayload = req.body.payload;
  const payload = Object.fromEntries(
    Object.entries(rawPayload).map(([k, v]) => [k, typeof v === 'string' ? stripHtml(v) : v])
  );
  const ticket = serviceTicketService.create({
    type: req.body.type,
    requestedBy: req.user.id,
    payload,
  });
  req.audit('service_ticket_create', String(ticket.id), { type: ticket.type });

  try {
    const emailService = require('../services/emailService');
    emailService.notifyAdminsServiceTicket(ticket, req.user.username);
  } catch { /* non-blocking */ }

  res.status(201).json({ ticket });
});

router.post('/:id(\\d+)/approve', requireRole('admin'), validate(resolveSchema), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ticket = serviceTicketService.getById(id);
    if (!ticket) return res.status(404).json({ error: 'Not found' });

    const execute = (payload) => {
      if (ticket.type === 'add_item') {
        // Surface duplicates as 409 here too — otherwise approve() would
        // silently merge into an existing row via equipmentService.create's
        // findByIdentifier fallback, leaving the requester thinking a new
        // item was added when really nothing changed.
        const dupe = equipmentService.findByIdentifier({
          barcode: payload.barcode,
          serial_number: payload.serial_number,
        });
        if (dupe) {
          const reqBc = (payload.barcode || '').trim().toLowerCase();
          const onField = dupe.barcode && reqBc &&
            dupe.barcode.trim().toLowerCase() === reqBc ? 'barcode' : 'serial number';
          throw Object.assign(
            new Error(`Duplicate ${onField}: already used by "${dupe.name}" (${dupe.barcode || 'no barcode'})`),
            { status: 409 }
          );
        }
        equipmentService.create({
          name:          payload.name || '',
          type:          payload.type || '',
          serial_number: payload.serial_number || '',
          barcode:       payload.barcode || '',
          category:      payload.category || '',
          location:      payload.location || '',
          location_id:   payload.location_id || null,
          model_id:      payload.model_id || null,
          notes:         payload.notes || '',
        });
      } else if (ticket.type === 'inventory_discrepancy') {
        const db = require('../db/connection');
        db.transaction(() => {
          for (const disc of (payload.discrepancies || [])) {
            const entry = db.prepare('SELECT item_name FROM audit_entries WHERE id = ?').get(disc.entry_id);
            if (!entry) continue;
            db.prepare(`
              UPDATE equipment
              SET quantity = ?, updated_at = datetime('now')
              WHERE lower(trim(name)) = lower(trim(?))
            `).run(disc.counted_qty, entry.item_name);
          }
        })();
      }
    };

    const resolved = serviceTicketService.approve(id, req.user.id, req.body.admin_notes, execute);
    req.audit('service_ticket_approve', String(id));
    res.json({ ticket: resolved });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post('/:id(\\d+)/reject', requireRole('admin'), validate(resolveSchema), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const resolved = serviceTicketService.reject(id, req.user.id, req.body.admin_notes);
    req.audit('service_ticket_reject', String(id));
    res.json({ ticket: resolved });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
