'use strict';
const config = require('../config');

// On-prem vision: Ollama only, no cloud fallback.
// We surface whatever Ollama returns — including low-confidence results —
// so the user can correct them on the verify card.

const PROMPT = `Identify this piece of equipment. Read any visible serial numbers, model numbers, or barcodes from labels. Return ONLY valid JSON, no other text:
{"name":"<short product name>","type":"<category>","serial":"<serial if visible, else empty>","barcode":"<barcode digits if visible, else empty>","confidence":<0-1>}`;

async function scanWithOllama(imageBase64) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.vision.ollamaTimeoutMs);
  try {
    const r = await fetch(`${config.vision.ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.vision.ollamaModel,
        prompt: PROMPT,
        images: [imageBase64],
        stream: false,
        format: 'json',
      }),
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`);
    const data = await r.json();
    try {
      return JSON.parse(data.response);
    } catch {
      throw new Error('Ollama returned non-JSON response');
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function scanImage(imageBase64 /* , mimeType */) {
  if (!config.vision.ollamaEnabled) {
    throw new Error('Vision scanning is disabled (OLLAMA_ENABLED=false)');
  }
  const result = await scanWithOllama(imageBase64);
  return { ...result, source: 'ollama' };
}

module.exports = { scanImage };
