// This is a new file for your backend (e.g., controllers/auth.controller.js)
// It handles the login logic.

// In a real app, you'd check a database. Here, we use a hardcoded password.
const MOCK_PASSWORD = 'Jh22350'; 
const MOCK_TOKEN = 'dummy-auth-token-123xyz';


export const loginUser = (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ success: false, error: 'Password is required' });
  }

  // Check if the password is correct
  if (password === MOCK_PASSWORD) {
    // We set the token in a secure, httpOnly cookie
    res.cookie('token', MOCK_TOKEN, {
      httpOnly: true, // Prevents client-side JS from reading the cookie
      secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
      maxAge: 1000 * 60 * 60 * 24 // 1 day
    });
    
    // We also send the token back so the React app knows it was successful
    res.json({ success: true, token: MOCK_TOKEN });
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