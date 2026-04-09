'use strict';
const DOMPurify = require('isomorphic-dompurify');

// HTML sanitizer for any user-supplied content that might end up rendered.
// Strips all tags by default for stored fields; the frontend should still use
// textContent rather than innerHTML.
function stripHtml(input) {
  if (input == null) return '';
  return DOMPurify.sanitize(String(input), { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
}

// Google Sheets formula injection guard. Cells starting with =, +, -, @ get
// prefixed with a single quote so Sheets doesn't evaluate them as a formula.
function escapeForSheets(input) {
  if (input == null) return '';
  const s = String(input);
  if (/^[=+\-@]/.test(s)) return "'" + s;
  return s;
}

module.exports = { stripHtml, escapeForSheets };
