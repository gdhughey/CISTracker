'use strict';
const express = require('express');
const queueService = require('../services/queueService');
const equipmentService = require('../services/equipmentService');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Get queue for a specific equipment item
router.get('/:equipmentId(\\d+)', (req, res) => {
  const equipmentId = parseInt(req.params.equipmentId, 10);
  const queue = queueService.getQueue(equipmentId);
  res.json({ queue });
});

// Join the queue
router.post('/:equipmentId(\\d+)/join', (req, res, next) => {
  try {
    const equipmentId = parseInt(req.params.equipmentId, 10);
    const eq = equipmentService.getById(equipmentId);
    if (!eq) return res.status(404).json({ error: 'Equipment not found' });
    if (eq.status === 'available') {
      return res.status(400).json({ error: 'Item is available — check it out directly' });
    }
    const entry = queueService.join(equipmentId, req.user.id);
    req.audit('queue_join', String(equipmentId));
    res.status(201).json({ entry, position: entry.position });
  } catch (err) { next(err); }
});

// Leave the queue
router.delete('/:equipmentId(\\d+)/leave', (req, res) => {
  const equipmentId = parseInt(req.params.equipmentId, 10);
  queueService.leave(equipmentId, req.user.id);
  req.audit('queue_leave', String(equipmentId));
  res.json({ ok: true });
});

// Admin: remove a user from queue
router.delete('/:equipmentId(\\d+)/user/:userId(\\d+)', requireRole('admin'), (req, res) => {
  const equipmentId = parseInt(req.params.equipmentId, 10);
  const userId = parseInt(req.params.userId, 10);
  queueService.removeUser(equipmentId, userId);
  req.audit('queue_remove_user', String(equipmentId), { removedUser: userId });
  res.json({ ok: true });
});

// My queue positions across all items
router.get('/my/positions', (req, res) => {
  res.json({ queues: queueService.getUserQueues(req.user.id) });
});

module.exports = router;
