'use strict';
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const { z } = require('zod');
const multer = require('multer');
const db = require('../db/connection');
const ticketService = require('../services/ticketService');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { stripHtml } = require('../utils/sanitize');
const emailService = require('../services/emailService');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'tickets');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/quicktime', 'video/webm',
]);

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '');
    cb(null, crypto.randomBytes(16).toString('hex') + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.has(file.mimetype)) cb(null, true);
    else cb(new Error('Only images and videos are allowed'));
  },
});

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

function getAttachments(ticketId) {
  return db.prepare(
    'SELECT * FROM ticket_attachments WHERE ticket_id = ? ORDER BY created_at ASC'
  ).all(ticketId);
}

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
  if (req.user.role !== 'admin' && ticket.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const comments = ticketService.getComments(ticket.id);
  const attachments = getAttachments(ticket.id);
  res.json({ ticket, comments, attachments });
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
  if (req.user.email) emailService.sendTicketConfirmation(req.user, ticket);
  res.status(201).json({ ticket });
});

// Upload attachment
router.post('/:id(\\d+)/attachments', (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  const ticket = ticketService.getById(id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && ticket.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const info = db.prepare(`
      INSERT INTO ticket_attachments (ticket_id, filename, original_name, mimetype, size, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, req.user.id);
    const attachment = db.prepare('SELECT * FROM ticket_attachments WHERE id = ?').get(info.lastInsertRowid);
    req.audit('ticket_attachment', String(id), { file: req.file.originalname });
    res.status(201).json({ attachment });
  });
});

// Update ticket (admin only for status/assignment, owner for subject/description)
router.put('/:id(\\d+)', validate(updateSchema), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const ticket = ticketService.getById(id);
  if (!ticket) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin') {
    if (ticket.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    const { subject, description } = req.body;
    const updated = ticketService.update(id, { subject, description });
    return res.json({ ticket: updated });
  }
  const becameAssignee    = req.body.assigned_to !== undefined && req.body.assigned_to === req.user.id && ticket.assigned_to !== req.user.id;
  const droppedAssignment = req.body.assigned_to === null && ticket.assigned_to === req.user.id;
  const reassignedToOther = req.body.assigned_to !== undefined && req.body.assigned_to !== null && req.body.assigned_to !== ticket.assigned_to;

  const updated = ticketService.update(id, req.body);

  if (req.body.status && req.body.status !== ticket.status && updated.reporter_email && updated.user_id !== req.user.id) {
    emailService.sendTicketStatusUpdate(
      { username: updated.reporter_username, email: updated.reporter_email },
      updated,
    );
  }

  if (becameAssignee) {
    req.audit('ticket_self_assign', String(id), { previous: ticket.assigned_to });
  } else if (droppedAssignment) {
    req.audit('ticket_unassign', String(id));
  } else if (reassignedToOther) {
    req.audit('ticket_assign', String(id), { from: ticket.assigned_to, to: req.body.assigned_to });
  } else {
    req.audit('ticket_update', String(id));
  }
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
