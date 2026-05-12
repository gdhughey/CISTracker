'use strict';
const crypto = require('crypto');
const express = require('express');
const { z } = require('zod');
const db = require('../db/connection');
const userService = require('../services/userService');
const equipmentService = require('../services/equipmentService');
const auditService = require('../services/auditService');
const config = require('../config');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { stripHtml } = require('../utils/sanitize');
const sessionService = require('../services/sessionService');
const emailService = require('../services/emailService');

// Generates a strong 14-char temp password that meets the app's complexity
// rules (uppercase, lowercase, digit, symbol, ≥10 chars). Mirrors the
// approach in scripts/seed.js.
function genTempPassword() {
  const upper  = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower  = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbol = '!@#$';
  const all    = upper + lower + digits + symbol;
  const pick   = (set) => set[crypto.randomBytes(1)[0] % set.length];
  // Guarantee one of each required class, then fill to 6
  let pw = pick(upper) + pick(lower) + pick(digits) + pick(symbol);
  for (let i = pw.length; i < 6; i++) pw += pick(all);
  return pw.split('').sort(() => crypto.randomBytes(1)[0] - 128).join('');
}

const router = express.Router();

router.use(requireAuth, requireRole('admin'));

const studentGroupEnum = z.enum(['am', 'pm', 'allday', 'staff', 'none']);

const createUserSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/),
  email: z.string().email(),
  password: z.string().optional(), // auto-generated if omitted
  role: z.enum(['admin', 'user']).default('user'),
  student_group: studentGroupEnum.default('none'),
});

const updateUserSchema = z.object({
  role: z.enum(['admin', 'user']).optional(),
  student_group: studentGroupEnum.optional(),
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
  if (req.body.student_group && req.body.student_group !== 'none') {
    userService.updateStudentGroup(user.id, req.body.student_group);
  }
  req.audit('admin_create_user', req.body.username, { role: req.body.role, group: req.body.student_group });
  emailService.sendWelcome(user, tempPw);
  res.status(201).json({ user: userService.pickPublic(userService.getById(user.id)), tempPassword: tempPw });
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
    if (req.body.role === 'admin' && user.role !== 'admin') {
      try {
        emailService.notifyNewAdmin(user.email, user.username);
      } catch { /* non-blocking */ }
    }
  }
  if (req.body.email && req.body.email !== user.email) {
    // Reject if another account already owns this email
    const taken = userService.getByEmail(req.body.email);
    if (taken && taken.id !== id) {
      return res.status(409).json({ error: 'That email is already in use' });
    }
    userService.updateEmail(id, req.body.email);
    req.audit('admin_change_email', user.username, { oldEmail: user.email, newEmail: req.body.email });
    emailService.sendEmailChanged(req.body.email, user.username);
  }
  if (req.body.reset_password) {
    const resetPw = genTempPassword();
    await userService.setPassword(id, resetPw);
    userService.forcePwChange(id);
    req.audit('admin_reset_password', user.username);
    // Kill sessions so they must log in with the new password
    sessionService.destroyAllForUser(id);
    res.locals.tempPassword = resetPw;
    emailService.sendWelcome(user, resetPw);
  }
  if (req.body.student_group !== undefined) {
    userService.updateStudentGroup(id, req.body.student_group);
    req.audit('admin_change_group', user.username, { group: req.body.student_group });
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

// ── CSV user import ──────────────────────────────────────────────────────────
const multer  = require('multer');
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1 * 1024 * 1024 } });

const VALID_ROLES_CSV  = new Set(['admin', 'user']);
const VALID_GROUPS_CSV = new Set(['am', 'pm', 'allday', 'staff', 'none']);

router.post('/users/import', csvUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const text = req.file.buffer.toString('utf8');
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return res.status(400).json({ error: 'CSV must have a header row and at least one data row' });

  const header = lines[0].toLowerCase().split(',').map(h => h.trim());
  const idx = {
    username: header.indexOf('username'),
    email:    header.indexOf('email'),
    role:     header.indexOf('role'),
    group:    header.indexOf('group'),
  };
  if (idx.username === -1 || idx.email === -1) {
    return res.status(400).json({ error: 'CSV missing required columns: username, email' });
  }

  const results = { created: 0, skipped: 0, failed: [], rows: [] };

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    const username = cols[idx.username];
    const email    = cols[idx.email];
    if (!username || !email) { results.failed.push(`Row ${i + 1}: missing username or email`); continue; }

    const role  = idx.role  !== -1 ? cols[idx.role]  : 'user';
    const group = idx.group !== -1 ? cols[idx.group] : 'none';
    const safeRole  = VALID_ROLES_CSV.has(role)   ? role  : 'user';
    const safeGroup = VALID_GROUPS_CSV.has(group.toLowerCase()) ? group.toLowerCase() : 'none';

    if (userService.getByUsername(username) || userService.getByEmail(email)) {
      results.skipped++;
      results.rows.push({ username, status: 'skipped' });
      continue;
    }

    try {
      const tempPw = genTempPassword();
      const created = await userService.createUser({ username, email, password: tempPw, role: safeRole, mustChangePw: 1 });
      userService.updateStudentGroup(created.id, safeGroup);
      req.audit('admin_import_user', username, { role: safeRole, group: safeGroup });
      emailService.sendWelcome(created, tempPw);
      results.created++;
      results.rows.push({ username, status: 'created' });
    } catch (err) {
      results.failed.push(`${username}: ${err.message}`);
      results.rows.push({ username, status: 'failed' });
    }
  }

  res.json(results);
});

router.get('/overdue', (req, res) => {
  const days = parseInt(req.query.days, 10) || 3;
  res.json({ items: equipmentService.getOverdue(days) });
});

router.get('/audit', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  res.json({ entries: auditService.recent(limit) });
});

// ── Locations CRUD ───────────────────────────────────────────────────────────

const locationSchema = z.object({
  name:        z.string().min(1).max(200).transform(stripHtml),
  building:    z.string().max(100).optional().nullable().transform(v => stripHtml(v || '') || null),
  room:        z.string().max(100).optional().nullable().transform(v => stripHtml(v || '') || null),
  description: z.string().max(500).optional().nullable().transform(v => stripHtml(v || '') || null),
});

router.get('/locations', (_req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM locations ORDER BY name').all();
    res.json({ locations: rows });
  } catch { res.json({ locations: [] }); }
});

router.post('/locations', validate(locationSchema), (req, res) => {
  const { name, building, room, description } = req.body;
  try {
    const info = db.prepare(`
      INSERT INTO locations (name, building, room, description)
      VALUES (?, ?, ?, ?)
    `).run(name, building || null, room || null, description || null);
    const loc = db.prepare('SELECT * FROM locations WHERE id = ?').get(info.lastInsertRowid);
    req.audit('location_create', name);
    res.status(201).json({ location: loc });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'A location with that name already exists' });
    }
    throw err;
  }
});

router.put('/locations/:id(\\d+)', validate(locationSchema), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const loc = db.prepare('SELECT * FROM locations WHERE id = ?').get(id);
  if (!loc) return res.status(404).json({ error: 'Not found' });
  const { name, building, room, description } = req.body;
  try {
    db.prepare(`
      UPDATE locations SET
        name        = ?,
        building    = ?,
        room        = ?,
        description = ?,
        updated_at  = datetime('now')
      WHERE id = ?
    `).run(name, building ?? null, room ?? null, description ?? null, id);
    req.audit('location_update', name);
    res.json({ location: db.prepare('SELECT * FROM locations WHERE id = ?').get(id) });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'A location with that name already exists' });
    }
    throw err;
  }
});

router.delete('/locations/:id(\\d+)', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const loc = db.prepare('SELECT * FROM locations WHERE id = ?').get(id);
  if (!loc) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM locations WHERE id = ?').run(id);
  req.audit('location_delete', loc.name);
  res.json({ ok: true });
});

// ── Categories CRUD ───────────────────────────────────────────────────────────
const categoryService = require('../services/categoryService');

const categorySchema = z.object({
  name: z.string().min(1).max(100).transform(v => stripHtml(v)),
});

router.get('/categories', (_req, res) => {
  try { res.json({ categories: categoryService.listAll() }); }
  catch { res.json({ categories: [] }); }
});

router.post('/categories', validate(categorySchema), (req, res) => {
  try {
    const cat = categoryService.create(req.body.name);
    req.audit('category_create', req.body.name);
    res.status(201).json({ category: cat });
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Category already exists' });
    throw err;
  }
});

router.put('/categories/:id(\\d+)', validate(categorySchema), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!categoryService.getById(id)) return res.status(404).json({ error: 'Not found' });
  const cat = categoryService.update(id, req.body.name);
  req.audit('category_update', req.body.name);
  res.json({ category: cat });
});

router.delete('/categories/:id(\\d+)', requireRole('admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const cat = categoryService.getById(id);
  if (!cat) return res.status(404).json({ error: 'Not found' });
  categoryService.remove(id);
  req.audit('category_delete', cat.name);
  res.json({ ok: true });
});

// ── Models CRUD ───────────────────────────────────────────────────────────────
const modelService = require('../services/modelService');

const modelSchema = z.object({
  name:        z.string().min(1).max(200).transform(v => stripHtml(v)),
  category_id: z.number().int().positive().optional().nullable(),
  description: z.string().max(1000).optional().transform(v => stripHtml(v || '')),
});

router.get('/models', (_req, res) => {
  try { res.json({ models: modelService.listAll() }); }
  catch { res.json({ models: [] }); }
});

router.get('/models/:id(\\d+)', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const model = modelService.getById(id);
  if (!model) return res.status(404).json({ error: 'Not found' });
  const units = modelService.getUnits(id);
  res.json({ model, units });
});

router.post('/models', requireRole('admin'), validate(modelSchema), (req, res) => {
  const model = modelService.create(req.body);
  req.audit('model_create', model.name);
  res.status(201).json({ model });
});

router.put('/models/:id(\\d+)', requireRole('admin'), validate(modelSchema.partial()), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!modelService.getById(id)) return res.status(404).json({ error: 'Not found' });
  const model = modelService.update(id, req.body);
  req.audit('model_update', model.name);
  res.json({ model });
});

router.delete('/models/:id(\\d+)', requireRole('admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const model = modelService.getById(id);
  if (!model) return res.status(404).json({ error: 'Not found' });
  modelService.remove(id);
  req.audit('model_delete', model.name);
  res.json({ ok: true });
});

module.exports = router;
