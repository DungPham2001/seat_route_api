/**
 * Forced update (feature 146): when the app sends `X-App-Version` older than MIN_APP_VERSION, every endpoint
 * except /v1/health answers 426 upgrade_required. Without the header nothing is blocked.
 */
const config = require('../config');
const { AppError } = require('../lib/errors');
const { compareVersions } = require('../lib/util');

function appVersion(req, _res, next) {
  const v = req.get('x-app-version');
  if (!v || req.path === '/health') return next();
  if (compareVersions(v, config.minAppVersion) < 0) {
    return next(new AppError(426, 'upgrade_required', { minAppVersion: config.minAppVersion, latestAppVersion: config.latestAppVersion }));
  }
  return next();
}

module.exports = { appVersion };
