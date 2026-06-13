import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { ZipArchive } from 'archiver';
import pLimit from 'p-limit';

import { getJson, ensureDirectoryExists } from '../../utils/file.js';
import { loadUrlStream } from '../../utils/api.js';
import { HISTORY_RECORD_PATH } from '../../config/config.js';
import { GROUP_CONFIG } from './blog.js';

// ==========================================
// Fanclub "history" = photo collections.
// Ported from zakamichi-blog-old:
//   - Hinatazaka46: JSON API (controller/hinatazaka.js → Hinatazaka46_History_Crawler)
// Each collection: { col_index, code, title, imageList:[{photo_index,image_src,title}] }
// ==========================================

const MAX_CONSECUTIVE_MISSES = 5; // stop scanning after this many empty indices in a row
const HARD_SCAN_CAP = 300;        // absolute upper bound to bound a fresh crawl
const DOWNLOAD_CONCURRENCY = 5;   // parallel image downloads when zipping a collection

// Per-group source definitions. Only groups listed here expose history.
const HISTORY_SOURCES = {
    Hinatazaka46: {
        type: 'json',
        homePage: 'https://hinatazaka46.com',
        startIndex: 1,
        code: (i) => `fc_photo_${i}`,
    },
};

// ── store helpers ─────────────────────────────────────────────────────────────

const storePath = (groupId) => path.join(HISTORY_RECORD_PATH, `${groupId}.json`);

const readStore = (groupId) => getJson(storePath(groupId), []);

const writeStore = async (groupId, collections) => {
    await ensureDirectoryExists(HISTORY_RECORD_PATH);
    await fs.promises.writeFile(storePath(groupId), JSON.stringify(collections, null, 2), 'utf-8');
};

// Normalize an image path to an absolute URL and strip the thumbnail suffix.
const absolutize = (src, homePage) => {
    if (!src) return src;
    const clean = src.replace('/750_750_102400', '');
    return /^https?:\/\//i.test(clean) ? clean : `${homePage}${clean}`;
};

// ── crawlers (one fetch per collection index) ─────────────────────────────────

async function fetchJsonCol(source, index) {
    const code = source.code(index);
    const url = `${source.homePage}/s/official/api/list/history?ct=${code}`;
    const { data } = await axios.get(url, { timeout: 15000 });
    const photos = data?.history_photo;
    if (!Array.isArray(photos) || photos.length === 0) return null;
    return {
        col_index: index,
        code,
        title: (photos[0].title || '').split('[')[0],
        imageList: photos.map((photo, photo_index) => ({
            photo_index,
            image_src: absolutize(photo.image_src, source.homePage),
            title: `${photo.code}.jpg`,
        })),
    };
}

const FETCHERS = { json: fetchJsonCol };

/**
 * Discover new collections for a group and merge them into the cached store.
 * Scans forward from startIndex, skipping already-known indices, and stops once
 * MAX_CONSECUTIVE_MISSES empty indices are hit (or the hard cap is reached).
 */
async function crawl(groupId) {
    const source = HISTORY_SOURCES[groupId];
    if (!source) throw new Error(`No history source for group "${groupId}"`);

    const collections = await readStore(groupId);
    const known = new Set(collections.map((c) => c.col_index));
    const fetcher = FETCHERS[source.type];

    let misses = 0;
    for (let i = source.startIndex; i <= HARD_SCAN_CAP && misses < MAX_CONSECUTIVE_MISSES; i++) {
        if (known.has(i)) { misses = 0; continue; }
        try {
            const col = await fetcher(source, i);
            if (col) {
                collections.push(col);
                known.add(i);
                misses = 0;
            } else {
                misses++;
            }
        } catch (err) {
            console.warn(`[HISTORY] ${groupId} #${i} failed: ${err.message}`);
            misses++;
        }
    }

    collections.sort((a, b) => b.col_index - a.col_index);
    await writeStore(groupId, collections);
    return collections;
}

// ==========================================
// Controllers
// ==========================================

// GET /api/fanclub/history/groups → groups that expose history
export const getHistoryGroups = async (_req, res) => {
    const data = Object.keys(HISTORY_SOURCES).map((id) => ({
        id,
        name: GROUP_CONFIG[id]?.name || id,
    }));
    return res.json({ success: true, data });
};

// GET /api/fanclub/history?group=Hinatazaka46 → collection summaries (no full image lists)
export const getHistoryList = async (req, res) => {
    try {
        const { group } = req.query;
        if (!HISTORY_SOURCES[group]) {
            return res.status(400).json({ success: false, error: 'Unknown or unsupported group' });
        }
        const collections = await readStore(group);
        const data = collections
            .sort((a, b) => b.col_index - a.col_index)
            .map((c) => ({
                col_index: c.col_index,
                code: c.code,
                title: c.title,
                intro: c.intro || '',
                cover: c.imageList?.[0]?.image_src || null,
                count: c.imageList?.length || 0,
            }));
        return res.json({ success: true, data });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

// GET /api/fanclub/history/collection?group=Hinatazaka46&code=fc_photo_1 → one full collection
export const getHistoryCollection = async (req, res) => {
    try {
        const { group, code } = req.query;
        if (!HISTORY_SOURCES[group]) {
            return res.status(400).json({ success: false, error: 'Unknown or unsupported group' });
        }
        const collections = await readStore(group);
        const col = collections.find((c) => c.code === code);
        if (!col) {
            return res.status(404).json({ success: false, error: 'Collection not found' });
        }
        return res.json({ success: true, data: col });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

// GET /api/fanclub/history/export?group=Hinatazaka46&code=fc_photo_1 → zip of one collection
export const exportHistoryCollection = async (req, res, next) => {
    let archive = null;
    let aborted = false;
    const abortController = new AbortController();
    const abortAll = (reason) => {
        if (aborted) return;
        aborted = true;
        abortController.abort();
        if (archive) archive.destroy();
        console.warn(`[HISTORY EXPORT] Aborted: ${reason}`);
    };
    res.on('close', () => {
        if (!res.writableEnded) abortAll('client_disconnect');
    });

    try {
        const { group, code } = req.query;
        if (!HISTORY_SOURCES[group]) {
            return res.status(400).json({ success: false, error: 'Unknown or unsupported group' });
        }
        const collections = await readStore(group);
        const col = collections.find((c) => c.code === code);
        if (!col || !col.imageList?.length) {
            return res.status(404).json({ success: false, error: 'Collection not found' });
        }

        // Folder name inside the zip = collection title (sanitized), falling back to its code.
        const folder = (col.title || col.code).replace(/[\\/:*?"<>|]/g, '_').trim() || col.code;

        archive = new ZipArchive({ zlib: { level: 1 } });
        archive.on('error', (err) => {
            console.error('Archive error:', err.message);
            abortAll('archive_error');
        });
        res.attachment(`${folder}.zip`);
        archive.pipe(res);

        const baseTime = Date.now();
        const limit = pLimit(DOWNLOAD_CONCURRENCY);
        await Promise.all(col.imageList.map((img) => limit(async () => {
            if (aborted) return;
            const data = await loadUrlStream(img.image_src, 3, { signal: abortController.signal });
            if (aborted) {
                if (data && typeof data.destroy === 'function') data.destroy();
                return;
            }
            if (data) {
                archive.append(data, {
                    name: path.join(folder, img.title),
                    date: new Date(baseTime + img.photo_index * 60 * 1000),
                });
            } else {
                console.warn(`✖ history image failed: ${img.image_src}`);
            }
        })));

        if (aborted) return;
        await archive.finalize();
        console.log(`[HISTORY EXPORT] ${group} ${code}: ${col.imageList.length} images`);
    } catch (err) {
        if (!res.headersSent) next(err);
        else console.error('[HISTORY EXPORT] Error after headers:', err.message);
    }
};

// POST /api/fanclub/history/refresh?group=Hinatazaka46 → crawl new collections
export const refreshHistory = async (req, res) => {
    try {
        const group = req.query.group || req.body?.group;
        if (!HISTORY_SOURCES[group]) {
            return res.status(400).json({ success: false, error: 'Unknown or unsupported group' });
        }
        const collections = await crawl(group);
        return res.json({ success: true, data: { count: collections.length } });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
};
