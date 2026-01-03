import { Router } from 'express';
import { getMessagesZip, getMessageDashboard, getMessagesPrompt } from './controllers/message.js';
import { loginUser, logoutUser, verifySession, checkAuth } from './controllers/auth.js';
import { getBlogDashboard, getBlogList, getBlogDetail, getBlogsZip, getBlogsPrompt } from './controllers/blog.js';

const router = Router();

// -------------- AUTH ROUTES --------------
// POST /api/login
router.post('/login', loginUser);
// POST /api/logout
router.post('/logout', logoutUser);
// GET /verify-session
router.post('/verify-session', verifySession);

// -------------- MESSAGE ROUTES --------------
// GET /api/message
router.post('/message', checkAuth, getMessageDashboard);
// GET /api/message/export
router.post('/message/export', checkAuth, getMessagesZip);
// GET /api/message/prompt
router.post('/message/prompt', checkAuth, getMessagesPrompt);

// -------------- BLOG ROUTES --------------
// GET /api/blog/detail
router.post('/blog/', checkAuth, getBlogDetail);
// GET /api/blog/dashboard
router.post('/blog/dashboard', checkAuth, getBlogDashboard);
// GET /api/blog/list
router.post('/blog/list', checkAuth, getBlogList);
// GET /api/blog/export
router.post('/blog/export', checkAuth, getBlogsZip);
// GET /api/blog/prompt
router.post('/blog/prompt', checkAuth, getBlogsPrompt);

export default router;