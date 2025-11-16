import 'dotenv/config';

// Server Configuration
export const PORT = parseInt(process.env.PORT || '22350', 10);

// Application Configuration
export const EXPORT_FILE_PATH = process.env.EXPORT_FILE_PATH || 'MessageExport';
export const RECORD_FILE_PATH = process.env.RECORD_FILE_PATH || 'Record'
export const CONFIG_FILE_NAME = process.env.CONFIG_FILE_NAME || 'config/config.json';
export const DESIRE_FILE_NAME =  process.env.DESIRE_FILE_NAME || 'config/Desired_Member_List.json'
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