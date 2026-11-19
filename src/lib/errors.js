/**
 * Error body (spec "Quy ước chung"): { code, message, fields?, requestId, ...extra } with the right HTTP status.
 * `message` is filled from i18n by code in the error handler unless given explicitly.
 */
class AppError extends Error {
  constructor(status, code, extra = {}, message) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.extra = extra;
    this.explicitMessage = message || null;
  }
}

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** `fields` = [{ field, code }] */
const invalid = (fields) => new AppError(400, 'validation_failed', { fields });
const unauthorized = (code = 'unauthorized') => new AppError(401, code);
const forbidden = (code = 'forbidden') => new AppError(403, code);
const notFound = () => new AppError(404, 'not_found');
const conflict = (code, extra) => new AppError(409, code, extra);
const tooMany = (retryAfter) => new AppError(429, 'too_many_attempts', { retryAfter });

module.exports = { AppError, asyncHandler, invalid, unauthorized, forbidden, notFound, conflict, tooMany };
