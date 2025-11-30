import 'dotenv/config';
import path from 'path'

// Server Configuration
export const PORT = parseInt(process.env.PORT || '22350', 10);

// Application Configuration
export const MESSAGE_BOT_PATH = process.env.MESSAGE_BOT_PATH || 'zakamichi-message-bot'
export const BLOG_BOT_PATH = process.env.BLOG_BOT_PATH || 'zakamichi-blog-bot'
export const EXPORT_FILE_PATH = path.join(MESSAGE_BOT_PATH, 'MessageExport');
export const RECORD_FILE_PATH = path.join(MESSAGE_BOT_PATH, 'Record');
export const CONFIG_FILE_NAME = path.join(MESSAGE_BOT_PATH, 'config/config.json');
export const DESIRE_FILE_NAME = path.join(MESSAGE_BOT_PATH, 'config/Desired_Member_List.json');
export const JWT_SECRET = process.env.JWT_SECRET || 'delirien-walzer-op-212'
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