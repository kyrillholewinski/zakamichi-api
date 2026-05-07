import { Router } from 'express';
import { getMessagesZip, getMessageDashboard, getMessagesPrompt } from './controllers/message.js';
import { loginUser, logoutUser, verifySession, checkAuth, checkAdmin } from './controllers/auth.js';
import { getBlogDashboard, getBlogList, getBlogDetail, getBlogsZip,getBlogImageLinks, getBlogsPrompt } from './controllers/blog.js';
import { getUserProfile, getAllMembers, updateDesired, updatePassword, getUsers, createUser, deleteUser } from './controllers/fanclub.js';

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
// GET /api/message/export
router.get('/message/export', checkAuth, getMessagesZip);
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

// -------------- FANCLUB ROUTES --------------
// GET /api/fanclub/profile
router.get('/fanclub/profile', checkAuth, getUserProfile);
// GET /api/fanclub/members
router.get('/fanclub/members', checkAuth, getAllMembers);
// POST /api/fanclub/desired
router.post('/fanclub/desired', checkAuth, updateDesired);
// POST /api/fanclub/password
router.post('/fanclub/password', checkAuth, updatePassword);
// GET /api/fanclub/users  (admin only)
router.get('/fanclub/users', checkAuth, checkAdmin, getUsers);
// POST /api/fanclub/users  (admin only)
router.post('/fanclub/users', checkAuth, checkAdmin, createUser);
// DELETE /api/fanclub/users/:username  (admin only)
router.delete('/fanclub/users/:username', checkAuth, checkAdmin, deleteUser);

export default router;