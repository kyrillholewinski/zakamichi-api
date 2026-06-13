import fs from 'fs';
import { getJson } from "../../utils/file.js";
import jwt from 'jsonwebtoken';
import { JWT_SECRET, COOKIE_SECURE } from "../../config/config.js";
import { isValidUsername, safeRecordPath } from "../../utils/validate.js";
import { verifyAndUpgrade } from "../../utils/password.js";

export const loginUser = async (req, res) => {
  const { user, password } = req.body;

  if (!password) {
    return res.status(400).json({ success: false, error: 'Password is required' });
  }
  if (!isValidUsername(user)) {
    // Same generic message as a bad password — don't reveal which field was wrong.
    return res.status(401).json({ success: false, error: 'Incorrect username or password' });
  }

  const recordPath = safeRecordPath(user);
  const record = await getJson(recordPath, null);

  // Verify, transparently upgrading any legacy plaintext password to bcrypt.
  const { ok, upgraded } = record ? verifyAndUpgrade(record, password) : { ok: false, upgraded: false };

  if (!ok) {
    return res.status(401).json({ success: false, error: 'Incorrect username or password' });
  }

  if (upgraded) {
    try {
      await fs.promises.writeFile(recordPath, JSON.stringify(record, null, 4), 'utf-8');
    } catch (err) {
      console.error('Failed to persist upgraded password hash:', err);
      // Non-fatal: the login still succeeds; we'll re-attempt the upgrade next time.
    }
  }

  const token = jwt.sign(
    { role: record.role, user },
    JWT_SECRET,
    { expiresIn: '1d' }
  );

  res.cookie('token', token, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000
  });

  res.json({ success: true, message: 'Login successful' });
};

// --- NEW FUNCTION ADDED ---
// This function clears the cookie on the server
export const logoutUser = (req, res) => {
  res.clearCookie('token');
  res.json({ success: true, message: 'Logged out successfully' });
};

export const checkAuth = (req, res, next) => {
  // We check for the 'token' cookie.
  const token = req.cookies.token;

  if (!token) {
    // No token, user is not logged in
    return res.status(401).json({ success: false, error: 'Not authorized, no token' });
  }

  // In a real app, you would verify the JWT here.
  // For this example, we'll just check if the token matches.
  try {
    // Decode and Verify logic
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    // If expired or invalid, return 401
    return res.status(401).json({ isAuthenticated: false });
  }
};

export const checkAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  next();
};

export const verifySession = (req, res) => {
  const token = req.cookies.token; // Read httpOnly cookie

  if (!token) {
    console.log("Do not have token")
    return res.status(401).json({ isAuthenticated: false });
  }

  try {
    // Decode and Verify logic
    const decoded = jwt.verify(token, JWT_SECRET);

    // If successful, return 200 OK
    return res.status(200).json({ isAuthenticated: true, user: decoded });
  } catch (err) {
    // If expired or invalid, return 401
    return res.status(401).json({ isAuthenticated: false });
  }
};
