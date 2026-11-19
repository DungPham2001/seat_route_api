const config = require('../config');
const { AppError } = require('../lib/errors');
const { t } = require('../i18n');

const notFound = (_req, _res, next) => next(new AppError(404, 'not_found'));

/**
 * Body: { code, message, fields?, requestId, ...extra }. Never leaks internals, never echoes tokens or passwords.
 * `message` is localized by code (Accept-Language); the app should still translate by `code`.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  let status = err.status || err.statusCode || 500;
  let code = typeof err.code === 'string' ? err.code : null;
  let extra = err.extra || {};
  let message = err.explicitMessage || null;

  if (err.code === 11000) {
    status = 409;
    code = 'duplicate';
    message = 'Duplicate';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    code = 'validation_failed';
    extra = { fields: [{ field: 'body', code: 'invalid_json' }] };
  } else if (err.type === 'entity.too.large') {
    status = 413;
    code = 'payload_too_large';
  }

  const known = err instanceof AppError || err.type || err.code === 11000;
  if (!known) status = 500;
  if (status >= 500) {
    console.error(req.requestId, err);
    code = status === 503 ? 'service_unavailable' : 'internal_error';
    extra = {};
    message = config.env === 'production' ? null : err.message;
  }
  if (status === 429 && extra.retryAfter) res.set('Retry-After', String(extra.retryAfter));
  res.status(status).json({ code: code || 'error', message: message || t(code, req.lang) || code, ...extra, requestId: req.requestId });
}

module.exports = { notFound, errorHandler };
