const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const config = require('./config');
const { context } = require('./middleware/context');
const { limiter } = require('./middleware/rateLimit');
const { appVersion } = require('./middleware/appVersion');
const { notFound, errorHandler } = require('./middleware/errors');
const api = require('./routes');
const deletion = require('./web/deletion');
const privacy = require('./web/privacy');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1); // behind Vercel / a proxy: req.ip is the client IP (rate limiting)
app.use(helmet());
app.use(cors({ origin: config.corsOrigins.length ? config.corsOrigins : false, exposedHeaders: ['Retry-After', 'X-Request-Id', 'Content-Disposition'] }));
app.use(compression());
// method, path, status, time only: query strings, bodies and headers (tokens, emails) are never logged
morgan.token('path', (req) => (req.originalUrl || req.url).split('?')[0]);
if (!config.isTest) app.use(morgan(':method :path :status :response-time ms'));
app.use(context);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use(deletion); // public web page for deletion requests (Google Play)
app.use(privacy); // public privacy policy page

// Vercel caps request bodies at 4.5 MB: receipt photos (multipart or base64 JSON) stay under 4 MB.
app.use('/v1', express.json({ limit: '4mb' }), limiter, appVersion, (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
}, api);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
