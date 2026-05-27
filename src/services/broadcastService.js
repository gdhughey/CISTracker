'use strict';
let _broadcast = null;

module.exports = {
  get() {
    if (_broadcast && Date.now() > _broadcast.expiresAt) _broadcast = null;
    return _broadcast ? { message: _broadcast.message, expiresAt: _broadcast.expiresAt } : null;
  },
  set(message, ttlMs) {
    if (!message) { _broadcast = null; return; }
    _broadcast = { message, expiresAt: Date.now() + ttlMs };
  },
  clear() { _broadcast = null; },
};
