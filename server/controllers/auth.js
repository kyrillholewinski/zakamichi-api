import { getJson } from "../../utils/file.js";
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from "../../config/config.js";

export const loginUser = async (req, res) => {
  const { user, password } = req.body;

  if (!password) {
    return res.status(400).json({ success: false, error: 'Password is required' });
  }

  const record = await getJson(`record/${user}.json`);

  // 1. Validate Password (Replace with your real logic)
  if (record && record.password == password) {
    // 2. Generate the Token
    const token = jwt.sign(
      { role: record.admin }, // Payload
      JWT_SECRET,
      { expiresIn: '1d' } // Token expiry
    );

    // 3. SET THE COOKIE (The Key Change)
    res.cookie('token', token, {
      httpOnly: true,  // Security: Client JS cannot read this
      secure: process.env.NODE_ENV === 'production', // HTTPS only in production
      sameSite: 'strict', // CSRF protection
      maxAge: 24 * 60 * 60 * 1000 // 1 day in milliseconds
    });

    res.json({ success: true, message: 'Login successful' });
  } else {
    // Incorrect password
    res.status(401).json({ success: false, error: 'Incorrect password' });
  }
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
    jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    // If expired or invalid, return 401
    return res.status(401).json({ isAuthenticated: false });
  }
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