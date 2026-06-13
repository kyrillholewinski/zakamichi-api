import path from 'path'
import { loadEnvFile } from 'node:process';
loadEnvFile();
// Server Configuration
export const PORT = parseInt(process.env.PORT || '22350', 10);

// Application Configuration
export const MESSAGE_BOT_PATH = process.env.MESSAGE_BOT_PATH || 'zakamichi-message-bot'
export const BLOG_BOT_PATH = process.env.BLOG_BOT_PATH || 'zakamichi-blog-bot'
export const EXPORT_FILE_PATH = path.join(MESSAGE_BOT_PATH, 'MessageExport');
export const RECORD_FILE_PATH = path.join(MESSAGE_BOT_PATH, 'Record');
export const CONFIG_FILE_NAME = path.join(MESSAGE_BOT_PATH, 'config/config.json');
export const DESIRE_FILE_NAME = path.join(MESSAGE_BOT_PATH, 'config/Desired_Member_List.json');
// Cached fanclub "history" (photo collections), one JSON file per group.
export const HISTORY_RECORD_PATH = path.join('record', 'history');
// Auth secret — REQUIRED. No insecure fallback: fail fast so a misconfigured
// deployment never runs with a predictable/guessable signing key.
export const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
    throw new Error(
        'JWT_SECRET is missing or too short. Set a strong random value (>=32 chars) ' +
        'in api/.env — e.g. `node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"`.'
    );
}

// Cross-origin + transport hardening.
// CORS_ORIGIN: the frontend origin allowed to call the API with credentials.
export const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';
// COOKIE_SECURE: send auth cookies only over HTTPS. Defaults on in production.
// Override to 'true'/'false' explicitly when running behind an HTTPS proxy.
export const COOKIE_SECURE = process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === 'true'
    : process.env.NODE_ENV === 'production';

// WebAuthn / Passkey configuration.
// NOTE: Passkeys only work on `localhost` or over HTTPS. For production set
// WEBAUTHN_RP_ID to your domain and WEBAUTHN_ORIGINS to its https origin(s).
export const WEBAUTHN_RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost';
export const WEBAUTHN_RP_NAME = process.env.WEBAUTHN_RP_NAME || 'Sakamichi Portal';
// Comma-separated list of allowed origins (the frontend URLs users load).
export const WEBAUTHN_ORIGINS = (process.env.WEBAUTHN_ORIGINS ||
    'http://localhost:3000,http://localhost')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
// API Constants
export const API_TYPE_TO_CODE = {
    text: '0',
    picture: '1',
    video: '2',
    voice: '3',
    url: '4'
};

// Timezone offset for file archiving (UTC+8)
export const DEFAULT_TIMEZONE_OFFSET_MS = 8 * 60 * 60 * 1000;
