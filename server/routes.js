import { Router } from 'express';
import { getMessagesZip, getMessageDashboard } from './controllers/message.js';
import { loginUser, logoutUser, verifySession, checkAuth } from './controllers/auth.js';
import { getBlogDashboard, getBlogList, getBlogDetail, getBlogsZip } from './controllers/blog.js';

const router = Router();

// POST /api/login
router.post('/login', loginUser);
// POST /api/logout
router.post('/logout', logoutUser);
// GET /verify-session
router.get('/verify-session', verifySession);
// GET /api/message
router.get('/message', checkAuth, getMessageDashboard);
// GET /api/message/export
router.get('/message/export', checkAuth, getMessagesZip);
// 2. Add the new blog routes
router.get('/blog/', checkAuth, getBlogDetail);
router.get('/blog/dashboard', checkAuth, getBlogDashboard);
router.get('/blog/list', checkAuth, getBlogList);
router.get('/blog/export', checkAuth, getBlogsZip);

export default router;