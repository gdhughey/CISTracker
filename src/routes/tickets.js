'use strict';
const express = require('express');
const { z } = require('zod');
const ticketService = require('../services/ticketService');
const emailService = require('../services/emailService');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { stripHtml } = require('../utils/sanitize');

const router = express.Router();
router.use(requireAuth);

const createSchema = z.object({
  subject: z.string().min(1).max(200).transform(stripHtml),
  description: z.string().max(5000).optional().transform(v => stripHtml(v || '')),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  equipment_id: z.number().int().positive().optional(),
});

const updateSchema = z.object({
  status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  assigned_to: z.number().int().positive().nullable().optional(),
  subject: z.string().min(1).max(200).transform(stripHtml).optional(),
  description: z.string().max(5000).transform(stripHtml).optional(),
});

const commentSchema = z.object({
  body: z.string().min(1).max(5000).transform(stripHtml),
});

// List tickets — admins see all, users see their own
router.get('/', (req, res) => {
  const opts = { limit: Math.min(parseInt(req.query.limit, 10) || 100, 500) };
  if (req.query.status) opts.status = req.query.status;
  if (req.user.role !== 'admin') opts.userId = req.user.id;
  res.json({ tickets: ticketService.listAll(opts) });
});

// Ticket counts (for sidebar badge)
router.get('/counts', (req, res) => {
  res.json(ticketService.counts());
});

// Get single ticket
router.get('/:id(\\d+)', (req, res) => {
  const ticket = ticketService.getById(parseInt(req.params.id, 10));
  if (!ticket) return res.status(404).json({ error: 'Not found' });
  // Non-admins can only see their own tickets
  if (req.user.role !== 'admin' && ticket.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const comments = ticketService.getComments(ticket.id);
  res.json({ ticket, comments });
});

// Create ticket
router.post('/', validate(createSchema), (req, res) => {
  const ticket = ticketService.create({
    userId: req.user.id,
    subject: req.body.subject,
    description: req.body.description,
    priority: req.body.priority,
    equipmentId: req.body.equipment_id,
  });
  req.audit('ticket_create', String(ticket.id));
  // Forward to support email
  emailService.sendSupportTicket(ticket, req.user.username).catch(() => {});
  res.status(201).json({ ticket });
});

// Update ticket (admin only for status/assignment, owner for subject/description)
router.put('/:id(\\d+)', validate(updateSchema), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const ticket = ticketService.getById(id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });
  // Non-admins can only update their own ticket's subject/description
  if (req.user.role !== 'admin') {
    if (ticket.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    const { subject, description } = req.body;
    const updated = ticketService.update(id, { subject, description });
    return res.json({ ticket: updated });
  }
  const updated = ticketService.update(id, req.body);
  req.audit('ticket_update', String(id));
  res.json({ ticket: updated });
});

// Add comment
router.post('/:id(\\d+)/comments', validate(commentSchema), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const ticket = ticketService.getById(id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && ticket.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const comment = ticketService.addComment(id, req.user.id, req.body.body);
  req.audit('ticket_comment', String(id));
  res.status(201).json({ comment });
});

// Delete ticket (admin only)
router.delete('/:id(\\d+)', requireRole('admin'), (req, res) => {
  ticketService.remove(parseInt(req.params.id, 10));
  req.audit('ticket_delete', req.params.id);
  res.json({ ok: true });
});

module.exports = router;
