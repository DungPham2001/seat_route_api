/**
 * Multipart upload of one receipt photo (field `file`, plus text field `note`), kept in memory.
 * The hard cap here is 4 MB (Vercel body limit 4.5 MB); the operator's own limit (settings.system.maxProofBytes)
 * and the content check are applied in services/proofs.js. JSON `{ image: base64, note }` also works.
 */
const multer = require('multer');
const { AppError } = require('../lib/errors');

const HARD_LIMIT = 4 * 1024 * 1024;
const single = multer({ storage: multer.memoryStorage(), limits: { fileSize: HARD_LIMIT, files: 1, fields: 5 } }).single('file');

function uploadOne(req, res, next) {
  if (!req.is('multipart/form-data')) return next();
  return single(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(new AppError(413, 'proof_too_large', { maxBytes: HARD_LIMIT }));
    return next(new AppError(400, 'proof_invalid_file', { fields: [{ field: 'file', code: err.code || 'invalid' }] }));
  });
}

module.exports = { uploadOne };
