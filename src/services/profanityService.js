'use strict';
const db = require('../db/connection');

// Built-in word list — common English profanity.
// Uses substring matching (catches variants like "f*ckswitch" too).
const BUILTIN = [
  'fuck','shit','ass','bitch','cunt','cock','dick','pussy','nigger','nigga',
  'fag','faggot','whore','slut','bastard','piss','crap','damn','hell',
  'retard','retarded','asshole','motherfucker','bullshit','horseshit',
  'jackass','dumbass','smartass','dipshit','douchebag','douche',
  'twat','wank','wanker','jerk','prick','skank',
];

// Cache custom words so we don't hit the DB on every keystroke check.
let _cache = null;
let _cacheAt = 0;
const CACHE_TTL = 30_000; // 30 s

function getCustomWords() {
  const now = Date.now();
  if (_cache && now - _cacheAt < CACHE_TTL) return _cache;
  try {
    _cache = db.prepare('SELECT word FROM word_blacklist').all().map(r => r.word.toLowerCase());
  } catch {
    _cache = [];
  }
  _cacheAt = now;
  return _cache;
}

function invalidateCache() {
  _cache = null;
}

/**
 * Check text for profanity.
 * Returns { ok: true } or { ok: false, word: 'the matched word' }.
 */
function check(text) {
  if (!text) return { ok: true };
  const lower = text.toLowerCase();
  for (const w of [...BUILTIN, ...getCustomWords()]) {
    if (lower.includes(w)) return { ok: false, word: w };
  }
  return { ok: true };
}

/**
 * Check multiple fields at once. Returns first violation found.
 */
function checkFields(fields) {
  for (const [, val] of Object.entries(fields)) {
    if (!val) continue;
    const result = check(String(val));
    if (!result.ok) return result;
  }
  return { ok: true };
}

function listCustom() {
  return db.prepare('SELECT w.*, u.username FROM word_blacklist w LEFT JOIN users u ON u.id = w.added_by ORDER BY w.added_at DESC').all();
}

function addWord(word, userId) {
  db.prepare('INSERT INTO word_blacklist (word, added_by) VALUES (?, ?)').run(word.trim().toLowerCase(), userId);
  invalidateCache();
}

function removeWord(id) {
  db.prepare('DELETE FROM word_blacklist WHERE id = ?').run(id);
  invalidateCache();
}

module.exports = { check, checkFields, listCustom, addWord, removeWord };
