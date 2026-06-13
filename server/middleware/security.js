import rateLimit from 'express-rate-limit';

// General limiter for the whole API surface — generous, just a DoS backstop.
export const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests, please slow down.' },
});

// Strict limiter for credential-checking endpoints — throttles brute force.
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    // Don't count successful logins against the limit.
    skipSuccessfulRequests: true,
    message: { success: false, error: 'Too many attempts, please try again later.' },
});
