import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRoutes from './routes.js';
import cors from 'cors';
import helmet from 'helmet';
import { EXPORT_FILE_PATH, CORS_ORIGIN } from '../config/config.js';
import { checkAuth } from './controllers/auth.js';
import { apiLimiter } from './middleware/security.js';
import cookieParser from 'cookie-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENT_BUILD_PATH = path.join(__dirname, '../public');
const app = express();

// --- Security headers ---
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // style-loader injects styles inline; blog content may carry inline styles.
      styleSrc: ["'self'", "'unsafe-inline'"],
      // Cloudflare auto-injects its Web Analytics beacon when proxying the site.
      scriptSrc: ["'self'", 'https://static.cloudflareinsights.com'],
      // Member photos / blog images are served from external HTTPS CDNs.
      imgSrc: ["'self'", 'data:', 'https:'],
      // Video/audio assets are served from the R2 public bucket.
      mediaSrc: ["'self'", 'https://pub-afd85e4b782042e3b1856c07d0f93ccd.r2.dev'],
      connectSrc: ["'self'", 'https://cloudflareinsights.com'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"], // clickjacking protection
      baseUri: ["'self'"],
    },
  },
  // We serve our own images/files; allow them to be embedded same-origin.
  crossOriginResourcePolicy: { policy: 'same-origin' },
}));

app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: '100kb' }));

// --- API Routes ---
app.use('/MessageExport', checkAuth, express.static(EXPORT_FILE_PATH));
app.use('/api', apiLimiter, apiRoutes);

// --- Static Files ---
app.use(express.static(CLIENT_BUILD_PATH));

// --- THE FIX: Catch-All Route ---
// Changed '*' to /.*/ to resolve the PathError
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(CLIENT_BUILD_PATH, 'index.html'));
});

// --- Global Error Handler ---
app.use((err, req, res, next) => {
  console.error('❌ Unhandled API Error:', err.stack || err.message);
  if (res.headersSent) {
    return next(err);
  }
  // Honor client-error status codes from middleware (e.g. body-parser's 413
  // PayloadTooLargeError, 400 malformed JSON) but never leak internal details.
  const status = err.status || err.statusCode;
  if (status && status >= 400 && status < 500) {
    return res.status(status).json({ error: 'Bad request' });
  }
  res.status(500).json({ error: 'An internal server error occurred.' });
});

export default app;