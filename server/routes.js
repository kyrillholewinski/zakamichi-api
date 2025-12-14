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
router.post('/verify-session', verifySession);
// GET /api/message
router.post('/message', checkAuth, getMessageDashboard);
// GET /api/message/export
router.post('/message/export', checkAuth, getMessagesZip);
// 2. Add the new blog routes
router.post('/blog/', checkAuth, getBlogDetail);
router.post('/blog/dashboard', checkAuth, getBlogDashboard);
router.post('/blog/list', checkAuth, getBlogList);
router.post('/blog/export', checkAuth, getBlogsZip);

export default router;