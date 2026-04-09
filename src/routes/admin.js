'use strict';
const express = require('express');
const { z } = require('zod');
const userService = require('../services/userService');
const equipmentService = require('../services/equipmentService');
const auditService = require('../services/auditService');
const config = require('../config');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = express.Router();

router.use(requireAuth, requireRole('admin'));

const createUserSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/),
  email: z.string().email(),
  password: z.string().min(config.auth.passwordMinLength),
  role: z.enum(['admin', 'user']).default('user'),
});

const updateUserSchema = z.object({
  role: z.enum(['admin', 'user']).optional(),
  reset_password: z.string().min(config.auth.passwordMinLength).optional(),
  unlock: z.boolean().optional(),
});

router.get('/users', (_req, res) => {
  res.json({ users: userService.listAll() });
});

router.get('/users/:id(\\d+)', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = userService.getById(id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json({
    user: userService.pickPublic(user),
    currentCheckouts: equipmentService.getCheckoutsForUser(id),
    history: equipmentService.getLog({ userId: id, limit: 50 }),
  });
});

router.post('/users', validate(createUserSchema), async (req, res) => {
  if (userService.getByUsername(req.body.username)) return res.status(409).json({ error: 'Username taken' });
  if (userService.getByEmail(req.body.email)) return res.status(409).json({ error: 'Email already registered' });
  const user = await userService.createUser({ ...req.body, mustChangePw: 1 });
  req.audit('admin_create_user', req.body.username, { role: req.body.role });
  res.status(201).json({ user: userService.pickPublic(user) });
});

router.put('/users/:id(\\d+)', validate(updateUserSchema), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = userService.getById(id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  if (req.body.role) {
    userService.updateRole(id, req.body.role);
    req.audit('admin_change_role', user.username, { newRole: req.body.role });
  }
  if (req.body.reset_password) {
    await userService.setPassword(id, req.body.reset_password);
    req.audit('admin_reset_password', user.username);
  }
  if (req.body.unlock) {
    userService.clearFailedLogins(id);
    req.audit('admin_unlock_user', user.username);
  }
  res.json({ user: userService.pickPublic(userService.getById(id)) });
});

router.delete('/users/:id(\\d+)', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) return res.status(400).json({ error: "You can't delete yourself" });
  const user = userService.getById(id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  userService.deleteUser(id);
  req.audit('admin_delete_user', user.username);
  res.json({ ok: true });
});

router.get('/overdue', (req, res) => {
  const days = parseInt(req.query.days, 10) || config.reminders.reminderDays;
  res.json({ items: equipmentService.getOverdue(days) });
});

router.get('/audit', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  res.json({ entries: auditService.recent(limit) });
});

module.exports = router;
