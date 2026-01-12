import { Router } from 'express';
import { getMessagesZip, getMessageDashboard, getMessagesPrompt } from './controllers/message.js';
import { loginUser, logoutUser, verifySession, checkAuth } from './controllers/auth.js';
import { getBlogDashboard, getBlogList, getBlogDetail, getBlogsZip,getBlogImageLinks, getBlogsPrompt } from './controllers/blog.js';

const router = Router();

// -------------- AUTH ROUTES --------------
// POST /api/login
router.post('/login', loginUser);
// POST /api/logout
router.post('/logout', logoutUser);
// GET /verify-session
router.post('/verify-session', verifySession);

// -------------- MESSAGE ROUTES --------------
// POST /api/message
router.post('/message', checkAuth, getMessageDashboard);
// POST /api/message/export
router.post('/message/export', checkAuth, getMessagesZip);
// POST /api/message/prompt
router.post('/message/prompt', checkAuth, getMessagesPrompt);

// -------------- BLOG ROUTES --------------
// POST /api/blog/detail
router.post('/blog/', checkAuth, getBlogDetail);
// POST /api/blog/dashboard
router.post('/blog/dashboard', checkAuth, getBlogDashboard);
// POST /api/blog/list
router.post('/blog/list', checkAuth, getBlogList);
// POST /api/blog/image/links
router.post('/blog/image/links', checkAuth, getBlogImageLinks);
// GET /api/blog/export
router.get('/blog/export', checkAuth, getBlogsZip);
// POST /api/blog/prompt
router.post('/blog/prompt', checkAuth, getBlogsPrompt);

export default router;