'use strict';
const express = require('express');
const multer = require('multer');
const visionService = require('../services/visionService');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const { scanLimiter } = require('../middleware/rateLimit');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.uploads.maxBytes },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype)) {
      return cb(new Error('Only image uploads are allowed'));
    }
    cb(null, true);
  },
});

const router = express.Router();

router.use(requireAuth, scanLimiter);

router.post('/', upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    const base64 = req.file.buffer.toString('base64');
    const result = await visionService.scanImage(base64, req.file.mimetype);
    req.audit('vision_scan', null, { source: result.source });
    res.json({ result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
