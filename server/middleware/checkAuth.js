// This is a new file: middleware/checkAuth.js

export const checkAuth = (req, res, next) => {
  // We check for the 'token' cookie.
  const token = req.cookies.token;

  if (!token) {
    // No token, user is not logged in
    return res.status(401).json({ success: false, error: 'Not authorized, no token' });
  }

  // In a real app, you would verify the JWT here.
  // For this example, we'll just check if the token matches.
  if (token === 'dummy-auth-token-123xyz') {
    // Token is valid, proceed to the next function (e.g., getDashboard)
    next();
  } else {
    // Token is invalid
    return res.status(401).json({ success: false, error: 'Not authorized, invalid token' });
  }
};