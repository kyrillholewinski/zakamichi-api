import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRoutes from './routes.js';
import cors from 'cors';
import { EXPORT_FILE_PATH } from '../config/config.js';
import { checkAuth } from './controllers/auth.js';
import cookieParser from 'cookie-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENT_BUILD_PATH = path.join(__dirname, '../public');
const app = express();

app.use(cors({
  origin: 'http://localhost:3000', // Ensure this matches your React port (usually 3000)
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json());

// --- API Routes ---
app.use('/MessageExport', checkAuth, express.static(EXPORT_FILE_PATH));
app.use('/api', apiRoutes);

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
  res.status(500).json({ error: 'An internal server error occurred.' });
});

export default app;