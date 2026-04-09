'use strict';

// Wraps a zod schema as Express middleware. On failure responds 400 with the
// flattened issues so the client can display field-level errors.
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        issues: result.error.flatten(),
      });
    }
    req[source] = result.data;
    next();
  };
}

module.exports = { validate };
