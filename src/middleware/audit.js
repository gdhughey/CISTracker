'use strict';
const auditService = require('../services/auditService');

// Attaches req.audit(action, target?, details?) to log security-relevant events.
// Pulls user/IP/UA automatically.
function audit(req, res, next) {
  req.audit = (action, target = null, details = null) => {
    auditService.write({
      userId: req.user ? req.user.id : null,
      action,
      target,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || '',
      details: details ? JSON.stringify(details) : null,
    });
  };
  next();
}

module.exports = { audit };
