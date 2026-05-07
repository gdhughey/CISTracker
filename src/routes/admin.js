'use strict';
const crypto = require('crypto');
const express = require('express');
const { z } = require('zod');
const userService = require('../services/userService');
const equipmentService = require('../services/equipmentService');
const auditService = require('../services/auditService');
const config = require('../config');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const sessionService = require('../services/sessionService');

// Generates a strong 14-char temp password that meets the app's complexity
// rules (uppercase, lowercase, digit, symbol, ≥10 chars). Mirrors the
// approach in scripts/seed.js.
function genTempPassword() {
  const upper  = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower  = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbol = '!@#$%&*+-=?';
  const all    = upper + lower + digits + symbol;
  const pick   = (set) => set[crypto.randomBytes(1)[0] % set.length];
  // Seed with one from each required class, then fill to 14 chars
  let pw = pick(upper) + pick(lower) + pick(digits) + pick(symbol);
  for (let i = pw.length; i < 14; i++) pw += pick(all);
  // Shuffle so the required chars aren't always in the same positions
  return pw.split('').sort(() => crypto.randomBytes(1)[0] - 128).join('');
}

const router = express.Router();

router.use(requireAuth, requireRole('admin'));

const createUserSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/),
  email: z.string().email(),
  password: z.string().optional(), // auto-generated if omitted
  role: z.enum(['admin', 'user']).default('user'),
});

const updateUserSchema = z.object({
  role: z.enum(['admin', 'user']).optional(),
  reset_password: z.boolean().optional(), // true = auto-gen new temp password
  unlock: z.boolean().optional(),
  email: z.string().email().max(254).optional(),
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
  const tempPw = genTempPassword();
  const user = await userService.createUser({ ...req.body, password: tempPw, mustChangePw: 1 });
  req.audit('admin_create_user', req.body.username, { role: req.body.role });
  res.status(201).json({ user: userService.pickPublic(user), tempPassword: tempPw });
});

router.put('/users/:id(\\d+)', validate(updateUserSchema), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = userService.getById(id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  if (req.body.role) {
    userService.updateRole(id, req.body.role);
    req.audit('admin_change_role', user.username, { newRole: req.body.role });
    // Kill their sessions so the role change takes effect immediately
    sessionService.destroyAllForUser(id);
  }
  if (req.body.email && req.body.email !== user.email) {
    // Reject if another account already owns this email
    const taken = userService.getByEmail(req.body.email);
    if (taken && taken.id !== id) {
      return res.status(409).json({ error: 'That email is already in use' });
    }
    userService.updateEmail(id, req.body.email);
    req.audit('admin_change_email', user.username, { oldEmail: user.email, newEmail: req.body.email });
  }
  if (req.body.reset_password) {
    const resetPw = genTempPassword();
    await userService.setPassword(id, resetPw);
    userService.forcePwChange(id);
    req.audit('admin_reset_password', user.username);
    // Kill sessions so they must log in with the new password
    sessionService.destroyAllForUser(id);
    res.locals.tempPassword = resetPw;
  }
  if (req.body.unlock) {
    userService.clearFailedLogins(id);
    req.audit('admin_unlock_user', user.username);
  }
  const result = { user: userService.pickPublic(userService.getById(id)) };
  if (res.locals.tempPassword) result.tempPassword = res.locals.tempPassword;
  res.json(result);
});

router.delete('/users/:id(\\d+)', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) return res.status(400).json({ error: "You can't delete yourself" });
  const user = userService.getById(id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  // Kill their sessions first so they're immediately logged out
  sessionService.destroyAllForUser(id);
  userService.deleteUser(id);
  req.audit('admin_delete_user', user.username);
  res.json({ ok: true });
});

router.get('/overdue', (req, res) => {
  const days = parseInt(req.query.days, 10) || 3;
  res.json({ items: equipmentService.getOverdue(days) });
});

router.get('/audit', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  res.json({ entries: auditService.recent(limit) });
});

module.exports = router;
