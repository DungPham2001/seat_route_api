const { randomBytes } = require('crypto');
const { langOf } = require('../i18n');

/** Request id for support + language from Accept-Language (vi default, en). */
function context(req, res, next) {
  req.requestId = `req_${randomBytes(6).toString('hex')}`;
  req.lang = langOf(req.get('accept-language'));
  res.set('X-Request-Id', req.requestId);
  next();
}

module.exports = { context };
