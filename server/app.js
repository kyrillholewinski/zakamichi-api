import express from 'express';
import apiRoutes from './routes.js';
import cors from 'cors'
import { EXPORT_FILE_PATH } from '../config/config.js';
import { checkAuth } from './middleware/checkAuth.js';
import cookieParser from 'cookie-parser'; 

const app = express();
// --- Middleware ---
app.use(cors({
  origin: 'http://localhost:80', // Your React app's URL
  credentials: true,
}));
app.use(cookieParser()); 
app.use(express.json());

// --- Routes ---
app.use(express.static('public'));
app.use('/MessageExport', checkAuth, express.static(EXPORT_FILE_PATH));
app.use('/api', apiRoutes);

// --- Global Error Handler ---
// Catches errors from async route handlers
app.use((err, req, res, next) => {
    console.error('❌ Unhandled API Error:', err.stack || err.message);
    if (res.headersSent) {
        return next(err);
    }
    res.status(500).json({ error: 'An internal server error occurred.' });
});

export default app;