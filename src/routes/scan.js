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

router.post(
  '/',
  (req, res, next) => {
    console.log('[scan] hit route, content-type:', req.headers['content-type']);
    upload.single('image')(req, res, (err) => {
      if (err) {
        console.error('[scan] multer error:', err.message);
        return res.status(400).json({ error: err.message });
      }
      next();
    });
  },
  async (req, res, next) => {
    try {
      console.log('[scan] multer ok, file?', !!req.file, 'size:', req.file && req.file.size);
      if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
      console.log('[scan] calling ollama at', config.vision.ollamaUrl, 'model', config.vision.ollamaModel);
      const base64 = req.file.buffer.toString('base64');
      const result = await visionService.scanImage(base64, req.file.mimetype);
      console.log('[scan] ollama returned:', JSON.stringify(result).slice(0, 200));
      req.audit('vision_scan', null, { source: result.source });
      res.json({ result });
    } catch (err) {
      console.error('[scan] FAILED:', err.message);
      console.error(err.stack);
      next(err);
    }
  }
);

module.exports = router;
