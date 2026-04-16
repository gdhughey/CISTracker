'use strict';
const config = require('../config');

// On-prem vision: Ollama only, no cloud fallback.
// We surface whatever Ollama returns — including low-confidence results —
// so the user can correct them on the verify card.

const PROMPT_SINGLE = `Identify this piece of equipment. Read any visible serial numbers, model numbers, or barcodes from labels. Return ONLY valid JSON, no other text:
{"name":"<short product name>","type":"<category>","serial":"<serial if visible, else empty>","barcode":"<barcode digits if visible, else empty>","confidence":<0-1>}`;

const PROMPT_MULTI = `These images show the SAME piece of equipment from different angles. Combine all visible information from every image to identify it. Read any visible serial numbers, model numbers, or barcodes from labels across all images. Return ONLY valid JSON, no other text:
{"name":"<short product name>","type":"<category>","serial":"<serial if visible, else empty>","barcode":"<barcode digits if visible, else empty>","confidence":<0-1>}`;

async function callOllama(imagesBase64) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.vision.ollamaTimeoutMs);
  const prompt = imagesBase64.length > 1 ? PROMPT_MULTI : PROMPT_SINGLE;
  try {
    const r = await fetch(`${config.vision.ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Note: we intentionally do NOT set format:'json' here.
      // Combining vision inputs with Ollama's forced-JSON grammar crashes
      // qwen2.5vl (HTTP 500). We ask for JSON in the prompt instead and
      // extract it loosely below.
      body: JSON.stringify({
        model: config.vision.ollamaModel,
        prompt,
        images: imagesBase64,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`Ollama HTTP ${r.status}: ${body.slice(0, 500)}`);
    }
    const data = await r.json();
    const raw = String(data.response || '');
    // Extract the first {...} block — models sometimes wrap JSON in prose
    // or markdown fences despite being asked not to.
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error(`Ollama returned non-JSON response: ${raw.slice(0, 200)}`);
    }
    try {
      return JSON.parse(match[0]);
    } catch (e) {
      throw new Error(`Ollama JSON parse failed: ${e.message} | raw: ${match[0].slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

// New: accepts array of base64 images
async function scanImages(imagesBase64) {
  if (!config.vision.ollamaEnabled) {
    throw new Error('Vision scanning is disabled (OLLAMA_ENABLED=false)');
  }
  if (!imagesBase64 || !imagesBase64.length) {
    throw new Error('No images provided');
  }
  const result = await callOllama(imagesBase64);
  return { ...result, source: 'ollama' };
}

// Backward compat: single image
async function scanImage(imageBase64) {
  return scanImages([imageBase64]);
}

module.exports = { scanImage, scanImages };
