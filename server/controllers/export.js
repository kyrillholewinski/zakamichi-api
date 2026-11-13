import fs from 'fs';
import os from 'os';
import path from 'path';
import { ZipArchive } from 'archiver';
import pLimit from 'p-limit';

import { getJson } from '../../utils/file.js';
import { parseDateTime } from '../../utils/date.js';
import {
    getAllBlogMembers,
    prepareDownloadTasks,
    executeDownloadTask,
} from './blog.js';
import {
    MESSAGE_BOT_PATH,
    RECORD_FILE_PATH,
    CONFIG_FILE_NAME,
    DESIRE_FILE_NAME,
    DEFAULT_TIMEZONE_OFFSET_MS,
} from '../../config/config.js';

const PROCESSOR_THREADS = os.availableParallelism() || 4;

// Message media is namespaced under this folder so it never collides with the
// blog tree, which keeps the exact layout the blog-only export produces.
const MESSAGE_PREFIX = 'message';

/**
 * GET /api/export/all?date=yyyyMMdd
 *
 * Streams ONE zip containing both sources for the caller's desired members:
 *   - blog images  -> unchanged paths (<groupFolder>/<member>/<file>)
 *   - message media -> message/<group>/<member>/<file>
 *
 * Blog images are fetched over the network; message media is read from disk,
 * so the two are collected concurrently into the same archive.
 */
export const getCombinedZip = async (req, res, next) => {
    let archive = null;
    let aborted = false;
    const abortController = new AbortController();

    const abortAll = (reason) => {
        if (aborted) return;
        aborted = true;
        abortController.abort();
        if (archive) archive.destroy();
        console.warn(`[COMBINED EXPORT] Aborted: ${reason}`);
    };

    res.on('close', () => {
        if (!res.writableEnded) abortAll('client_disconnect');
    });

    try {
        const { date } = req.query;

        // Same cutoff for both sources so the zip is one coherent time slice.
        // Defaults to the last 7 days, matching the message export.
        let cutoffDate = new Date(Date.now() - 7 * 24 * 3600 * 1000);
        if (date) {
            const parsed = new Date(parseDateTime(date, 'yyyyMMdd'));
            if (!isNaN(parsed)) cutoffDate = parsed;
        }

        // Which members to include — the caller's own desired list.
        const authUser = req.user?.user;
        let desiredList = [];
        if (authUser) {
            const userRecord = await getJson(path.join('record', `${authUser}.json`));
            desiredList = userRecord?.desired || [];
        } else {
            desiredList = await getJson(DESIRE_FILE_NAME);
        }
        const desiredSet = new Set(desiredList);

        if (!desiredSet.size) {
            return res.status(404).json({
                success: false,
                error: 'No preferred members selected. Pick members on the User page first.',
            });
        }

        // ── Blog side ────────────────────────────────────────────────────────
        const allBlogMembers = await getAllBlogMembers();
        const blogMembers = allBlogMembers.filter(m => desiredSet.has(m.Name));
        const blogTasks = prepareDownloadTasks(blogMembers, cutoffDate, null);

        // ── Message side ─────────────────────────────────────────────────────
        const configGroups = await getJson(CONFIG_FILE_NAME);
        const messageFiles = [];
        for (const group of configGroups) {
            for (const m of group.members) {
                if (!desiredSet.has(m.name)) continue;
                try {
                    const msgPath = path.join(RECORD_FILE_PATH, group.name, m.name, `${m.id}_timeline_messages.json`);
                    const messages = await getJson(msgPath);
                    for (const msg of messages) {
                        if (!msg.local_file) continue;
                        const msgDate = new Date(msg.published_at);
                        if (isNaN(msgDate) || msgDate < cutoffDate) continue;
                        messageFiles.push({
                            absPath: path.join(MESSAGE_BOT_PATH, msg.local_file),
                            archivePath: path.join(MESSAGE_PREFIX, group.name, m.name, path.basename(msg.local_file)),
                            date: new Date(msgDate.getTime() + DEFAULT_TIMEZONE_OFFSET_MS),
                        });
                    }
                } catch (err) {
                    console.error(`[COMBINED EXPORT] Skipped ${m.name}: ${err.message}`);
                }
            }
        }

        // ── Stream ───────────────────────────────────────────────────────────
        archive = new ZipArchive({ zlib: { level: 1 } });
        archive.on('warning', (err) => {
            if (err.code === 'ENOENT') console.warn('[COMBINED EXPORT] warning:', err.message);
            else console.error('[COMBINED EXPORT] warning:', err);
        });
        archive.on('error', (err) => {
            console.error('[COMBINED EXPORT] Archive error:', err.message);
            abortAll('archive_error');
            if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
        });

        res.attachment('DCIM.zip');
        archive.pipe(res);

        const limit = pLimit(PROCESSOR_THREADS);

        const blogPromises = blogTasks.map(task =>
            limit(() => executeDownloadTask(task, archive, {
                signal: abortController.signal,
                isAborted: () => aborted,
            }))
        );

        const messagePromises = messageFiles.map(file =>
            limit(async () => {
                if (aborted) return;
                try {
                    await fs.promises.access(file.absPath, fs.constants.R_OK);
                    if (aborted) return;
                    const stream = fs.createReadStream(file.absPath, { highWaterMark: 64 * 1024 });
                    if (aborted) { stream.destroy(); return; }
                    archive.append(stream, { name: file.archivePath, date: file.date });
                } catch (err) {
                    if (err.code === 'ENOENT') console.warn(`[COMBINED EXPORT] Missing file: ${file.absPath}`);
                    else console.error(`[COMBINED EXPORT] ${file.absPath}: ${err.message}`);
                }
            })
        );

        await Promise.all([...blogPromises, ...messagePromises]);

        if (aborted) return;
        await archive.finalize();

        console.log('[COMBINED EXPORT] Completed', {
            members: desiredSet.size,
            blogImages: blogTasks.length,
            messageFiles: messageFiles.length,
            cutoff: cutoffDate.toISOString().slice(0, 10),
        });
    } catch (err) {
        console.error('[COMBINED EXPORT] Error:', err);
        if (!res.headersSent) next(err);
    }
};
