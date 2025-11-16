import fs from 'fs';
import path from 'path';
import axios from 'axios';

export const ensureDirectoryExists = async (dirPath) => {
    try {
        await fs.promises.access(dirPath);
    } catch {
        console.log(`📁 Creating directory: ${dirPath}`);
        await fs.promises.mkdir(dirPath, { recursive: true });
    }
};

export const getJsonList = async (filePath) => {
    try {
        await fs.promises.access(filePath);
        const data = await fs.promises.readFile(filePath, 'utf-8');
        return JSON.parse(data) || [];
    } catch (err) {
        if (err.code !== 'ENOENT') {
            console.error(`Error reading JSON from ${filePath}:`, err.message);
        }
        return []; // Return empty list if file not found
    }
};

export const downloadFile = async (url, localPath) => {
    try {
        await fs.promises.access(localPath);
        console.log(`[CACHE] Using existing file: ${path.basename(localPath)}`);
        return true;
    } catch {
        try {
            const { data } = await axios.get(url, { responseType: 'stream' });
            const writer = data.pipe(fs.createWriteStream(localPath));
            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });
            console.log(`[DOWNLOADED] ${path.basename(localPath)}`);
            return true;
        } catch (downloadErr) {
            console.warn(`⚠️ Failed to download file: ${downloadErr.message}`);
            // Clean up partial file
            try { await fs.promises.unlink(localPath); } catch { }
            return false;
        }
    }
};
