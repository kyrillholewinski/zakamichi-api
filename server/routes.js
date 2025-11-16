import { Router } from 'express';
import { getMessagesZip } from './controllers/message.js';
import { getDashboard } from './controllers/dashboard.js';
import { loginUser,logoutUser } from './controllers/auth.js';
import { checkAuth } from './middleware/checkAuth.js';

const router = Router();

// GET /api/dashboard
router.get('/dashboard', checkAuth, getDashboard);

// GET /api/message
router.get('/message', checkAuth, getMessagesZip);

// POST /api/login
router.post('/login', loginUser);

// POST /api/logout
router.post('/logout', loginUser);

export default router;