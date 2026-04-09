'use strict';
const config = require('../config');

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
    let parsed;
    try {
      parsed = JSON.parse(data.response);
    } catch {
      throw new Error('Ollama returned non-JSON response');
    }
    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

async function scanWithSonnet(imageBase64, mimeType) {
  if (!config.vision.anthropicKey) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': config.vision.anthropicKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
          { type: 'text', text: PROMPT },
        ],
      }],
    }),
  });
  if (!r.ok) throw new Error(`Sonnet HTTP ${r.status}`);
  const body = await r.json();
  const text = body.content?.[0]?.text || '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Sonnet returned no JSON');
  return JSON.parse(match[0]);
}

async function scanImage(imageBase64, mimeType) {
  if (config.vision.ollamaEnabled) {
    try {
      const result = await scanWithOllama(imageBase64);
      if ((result.confidence ?? 1) >= 0.6) {
        return { ...result, source: 'ollama' };
      }
      // low confidence — fall through to Sonnet if available
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[vision] Ollama failed:', err.message);
    }
  }
  if (config.vision.anthropicKey) {
    const result = await scanWithSonnet(imageBase64, mimeType);
    return { ...result, source: 'sonnet' };
  }
  throw new Error('No vision backend available');
}

module.exports = { scanImage };
