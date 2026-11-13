import { ZipArchive } from 'archiver';
import path from 'path';
import fs from 'fs';
import os from 'os';
import pLimit from 'p-limit';
import { getJson } from '../../utils/file.js';
import { parseDateTime } from '../../utils/date.js';
import { MESSAGE_BOT_PATH, RECORD_FILE_PATH, DEFAULT_TIMEZONE_OFFSET_MS, CONFIG_FILE_NAME, DESIRE_FILE_NAME } from '../../config/config.js';

const PROCESSOR_THREADS = os.availableParallelism() || 4;

export const getMessageDashboard = async (req, res, next) => {
    const { group, member, limit = 20, page = 1, types, until_date } = req.body;
    const nLimit = parseInt(limit, 10);
    const nPage = parseInt(page, 10);
    const includeRecentMessages = Boolean(member);

    const typeFilter = Array.isArray(types) && types.length > 0 ? new Set(types) : null;

    let cutoffEnd = null;
    if (until_date) {
        const parsed = parseDateTime(until_date, 'yyyyMMdd');
        if (parsed) {
            const d = new Date(parsed);
            if (!isNaN(d)) {
                d.setHours(23, 59, 59, 999);
                cutoffEnd = d;
            }
        }
    }

    try {
        const configGroups = await getJson(CONFIG_FILE_NAME);
        if (!configGroups.length) {
            return res.status(404).json({ error: 'No groups found' });
        }

        const { user: authUser } = req.user;
        let ignoreList = [];
        if (authUser) {
            const userDesirePath = path.join('record', `${authUser}.json`);
            const { ignore } = await getJson(userDesirePath);
            ignoreList = ignore || [];
        } else {
            ignoreList = await getJson(DESIRE_FILE_NAME);
        }

        const dashboardData = [];
        // Groups are still processed sequentially, which is fine.
        for (const g of configGroups) {
            if (group && g.name !== group) continue;
            // --- OPTIMIZATION: Filter members before processing ---
            const membersToProcess = g.members.filter(m => (!member || m.name === member ) && !ignoreList.includes(m.name));

            // --- OPTIMIZATION: Process all members *within* this group in parallel ---
            const memberPromises = membersToProcess.map(async (m) => {
                try {
                    const memberDir = path.join(RECORD_FILE_PATH, g.name, m.name);
                    const memberInfoPath = path.join(memberDir, `${m.id}_members.json`);
                    const memberInfos = await getJson(memberInfoPath); // Read member info
                    // --- OPTIMIZATION: Fetch member's files in parallel ---
                    const member_info = memberInfos.length > 0 ? memberInfos[0] : {};
                    // --- NOTE: This is still a performance bottleneck if files are large ---
                    let paginatedMessages = [];
                    let has_more = false;
                    let message_count = 0;
                    if (includeRecentMessages) {
                        // Read messages
                        const msgPath = path.join(memberDir, `${m.id}_timeline_messages.json`);
                        let messages = await getJson(msgPath);
                        if (typeFilter) {
                            messages = messages.filter(msg => typeFilter.has(msg.type));
                        }
                        if (cutoffEnd) {
                            messages = messages.filter(msg => new Date(msg.published_at) <= cutoffEnd);
                        }
                        message_count = messages.length;
                        messages.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
                        const startIndex = (nPage - 1) * nLimit;
                        const endIndex = nPage * nLimit;
                        paginatedMessages = messages.slice(startIndex, endIndex);
                        has_more = endIndex < messages.length;
                    }

                    // Return the data for this member
                    return {
                        member: m.name,
                        member_id: m.id,
                        message_count,
                        thumbnail: member_info.thumbnail,
                        phone_image: member_info.phone_image,
                        has_more,
                        recent_messages: paginatedMessages.map(msg => ({
                            id: msg.id,
                            published_at: msg.published_at,
                            text: msg.text || '',
                            local_file: msg.local_file || null,
                            type: msg.type,
                            translated_text: msg.translated_text || '',
                        })),
                    };
                } catch (err) {
                    // --- OPTIMIZATION: Handle errors for a single member ---
                    // This prevents one missing file from failing the entire request.
                    console.error(`Failed to process member ${m.name} in group ${g.name}: ${err.message}`);
                    return null; // Return null to be filtered out later
                }
            });

            // Wait for all members in this group to be processed
            const processedMembers = await Promise.all(memberPromises);

            // Filter out any members that failed (returned null)
            const validMembers = processedMembers.filter(m => m !== null);

            if (validMembers.length > 0) {
                dashboardData.push({
                    group: g.name,
                    members: validMembers,
                });
            }
        }
        res.json(dashboardData);
    } catch (err) {
        next(err); // Pass other critical errors to global handler
    }
};

// ── Message frequency analytics ──────────────────────────────────────────────
//
// Buckets every member's timeline into per-period counts server-side. Doing this
// on the client would mean shipping ~150k message records; here it collapses to
// one small number per member per period.
//
// Bucketing uses DEFAULT_TIMEZONE_OFFSET_MS (the project's UTC+8 convention, as
// in the zip export) so a "day" matches what users see, independent of the
// server's own timezone.

const MAX_PERIODS = { daily: 366, monthly: 60 };
const DEFAULT_PERIODS = { daily: 30, monthly: 12 };

const shiftedDate = (ms) => new Date(ms + DEFAULT_TIMEZONE_OFFSET_MS);

const periodKey = (date, granularity) => {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    if (granularity === 'monthly') return `${y}-${m}`;
    return `${y}-${m}-${String(date.getUTCDate()).padStart(2, '0')}`;
};

// Ascending list of the last `count` periods, ending with the current one.
const buildPeriods = (granularity, count) => {
    const now = shiftedDate(Date.now());
    const periods = [];
    if (granularity === 'monthly') {
        for (let i = count - 1; i >= 0; i--) {
            periods.push(periodKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)), 'monthly'));
        }
    } else {
        const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
        for (let i = count - 1; i >= 0; i--) {
            periods.push(periodKey(new Date(base - i * 86400000), 'daily'));
        }
    }
    return periods;
};

// POST /api/message/stats
export const getMessageStats = async (req, res, next) => {
    try {
        const { granularity = 'daily', group, members } = req.body;
        if (granularity !== 'daily' && granularity !== 'monthly') {
            return res.status(400).json({ success: false, error: "granularity must be 'daily' or 'monthly'" });
        }

        const requested = parseInt(req.body.periods, 10);
        const periodCount = Number.isNaN(requested)
            ? DEFAULT_PERIODS[granularity]
            : Math.min(Math.max(requested, 1), MAX_PERIODS[granularity]);

        const periods = buildPeriods(granularity, periodCount);
        const periodIndex = new Map(periods.map((p, i) => [p, i]));
        const memberFilter = Array.isArray(members) && members.length ? new Set(members) : null;

        const configGroups = await getJson(CONFIG_FILE_NAME);
        if (!configGroups.length) {
            return res.status(404).json({ success: false, error: 'No groups found' });
        }

        // Same per-user hidden-member handling as the dashboard.
        const { user: authUser } = req.user;
        let ignoreList = [];
        if (authUser) {
            const { ignore } = await getJson(path.join('record', `${authUser}.json`));
            ignoreList = ignore || [];
        }
        const ignoreSet = new Set(ignoreList);

        const limit = pLimit(PROCESSOR_THREADS);
        const tasks = [];

        for (const g of configGroups) {
            if (group && g.name !== group) continue;
            for (const m of g.members) {
                if (ignoreSet.has(m.name)) continue;
                if (memberFilter && !memberFilter.has(m.name)) continue;

                tasks.push(limit(async () => {
                    try {
                        const msgPath = path.join(RECORD_FILE_PATH, g.name, m.name, `${m.id}_timeline_messages.json`);
                        const messages = await getJson(msgPath);

                        const counts = new Array(periods.length).fill(0);
                        let total = 0;
                        for (const msg of messages) {
                            if (!msg.published_at) continue;
                            const ts = new Date(msg.published_at).getTime();
                            if (Number.isNaN(ts)) continue;
                            const idx = periodIndex.get(periodKey(shiftedDate(ts), granularity));
                            if (idx === undefined) continue; // outside the window
                            counts[idx] += 1;
                            total += 1;
                        }
                        return { member: m.name, member_id: m.id, group: g.name, total, counts };
                    } catch (err) {
                        console.error(`Stats failed for ${m.name}: ${err.message}`);
                        return null;
                    }
                }));
            }
        }

        const rows = (await Promise.all(tasks)).filter(Boolean);
        // Busiest first, so the client can default to the most active members.
        rows.sort((a, b) => b.total - a.total || a.member.localeCompare(b.member));

        return res.json({
            success: true,
            data: { granularity, periods, members: rows },
        });
    } catch (err) {
        next(err);
    }
};

export const getMessagesZip = async (req, res, next) => {
    let archive = null;
    let aborted = false;

    const abortAll = (reason) => {
        if (aborted) return;
        aborted = true;
        if (archive) {
            archive.destroy();
        }
        console.warn(`[MESSAGE ZIP] Aborted: ${reason}`);
    };

    res.on('close', () => {
        if (!res.writableEnded) {
            abortAll('client_disconnect');
        }
    });

    try {
        const { member, date } = req.query;

        // 1) Determine cutoff date
        const defaultDate = new Date(Date.now() - 7 * 24 * 3600 * 1000); // 7 days ago
        let lastUpdate = defaultDate;
        if (date) {
            const parsed = new Date(parseDateTime(date, 'yyyyMMdd'));
            if (!isNaN(parsed)) lastUpdate = parsed;
        }

        const cutoffDate = lastUpdate;

        // Load configs
        const configGroups = await getJson(CONFIG_FILE_NAME);
        const { user: authUser } = req.user;
        let desiredList = [];
        if (authUser) {
            const userDesirePath = path.join('record', `${authUser}.json`);
            const { desired } = await getJson(userDesirePath);
            desiredList = desired || [];
        } else {
            desiredList = await getJson(DESIRE_FILE_NAME);
        }

        // OPTIMIZATION: Use a Set for fast O(1) lookups
        const desiredSet = new Set(desiredList);

        // NOTE: zlib level 9 is max compression but slowest.
        // For faster speed, use level 6 (default) or 1 (fastest).
        archive = new ZipArchive({ zlib: { level: 1 } });

        // Handle archive errors
        archive.on('warning', (err) => {
            if (err.code === 'ENOENT') {
                console.warn('Archive warning (file not found):', err.message);
            } else {
                console.error('Archive warning:', err);
            }
        });

        archive.on('error', (err) => {
            console.error('Fatal archive error:', err.message);
            abortAll('archive_error');
            if (!res.headersSent) {
                res.status(500).send({ error: 'Internal server error' });
            }
        });

        res.attachment('Message.zip');
        archive.pipe(res);

        const limit = pLimit(PROCESSOR_THREADS);

        // OPTIMIZATION: Process all files in parallel with a shared limiter
        const appendTasks = [];

        for (const group of configGroups) {
            if (aborted) break;
            for (const m of group.members) {
                if (aborted) break;
                // Check if this member is desired
                const isQueryMatch = member && m.name === member;
                const isDesiredListMatch = !member && desiredSet.has(m.name); // Only check set if no specific member query

                if (isQueryMatch || isDesiredListMatch) {
                    try {
                        const memberDir = path.join(RECORD_FILE_PATH, group.name, m.name);
                        const messagesJsonPath = path.join(memberDir, `${m.id}_timeline_messages.json`);
                        const existingMessages = await getJson(messagesJsonPath);
                        if (existingMessages.length === 0) {
                            continue; // This member has no messages, skip
                        }
                        const archivePathPrefix = member ? '' : path.join(group.name, m.name);
                        for (const msg of existingMessages) {
                            const msgDate = new Date(msg.published_at);

                            // Filter by date
                            if (cutoffDate && msgDate < cutoffDate) continue;
                            // Skip if no file
                            if (!msg.local_file) continue;

                            const fileName = path.join(MESSAGE_BOT_PATH, msg.local_file);
                            const fileDate = new Date(msgDate.getTime() + DEFAULT_TIMEZONE_OFFSET_MS);
                            const archiveName = path.join(archivePathPrefix, path.basename(msg.local_file));

                            appendTasks.push(limit(async () => {
                                if (aborted) return;
                                try {
                                    // ASYNC CHECK: Check for read access without blocking
                                    await fs.promises.access(fileName, fs.constants.R_OK);
                                    // File exists, append it.
                                    // archive.append is non-blocking and handles the stream.
                                    if (aborted) return;
                                    const data = fs.createReadStream(fileName, { highWaterMark: 64 * 1024 });
                                    if (aborted) {
                                        data.destroy();
                                        return;
                                    }
                                    archive.append(data, { name: archiveName, date: fileDate });
                                } catch (fileErr) {
                                    // File doesn't exist or isn't readable, warn and skip
                                    if (fileErr.code === 'ENOENT') {
                                        console.warn(`File not found, skipping: ${fileName}`);
                                    } else {
                                        console.error(`Error accessing file ${fileName}:`, fileErr.message);
                                    }
                                }
                            }));
                        }
                    } catch (err) {
                        console.error(`Failed to process member ${m.name}:`, err.message);
                    }
                }
            }
        }

        // Wait for all files to be processed in parallel
        await Promise.all(appendTasks);

        // All files have been appended, finalize the archive.
        if (aborted) return;
        await archive.finalize();

    } catch (err) {
        next(err); // Pass error to global handler
    }
};

export const getMessagesPrompt = async (req, res, next) => {
    try {
        const { member, date, all } = req.body;
        // 1) Determine cutoff date. `all` exports the whole history (no cutoff).
        const defaultDate = new Date(Date.now() - 7 * 24 * 3600 * 1000); // 7 days ago
        let lastUpdate = defaultDate;
        if (date) {
            const parsed = new Date(parseDateTime(date, 'yyyyMMdd'));
            if (!isNaN(parsed)) lastUpdate = parsed;
        }

        const cutoffDate = all ? null : lastUpdate;

        // Load configs
        const configGroups = await getJson(CONFIG_FILE_NAME);
        const { user: authUser } = req.user;
        let desiredList = [];
        if (authUser) {
            const { desired } = await getJson(path.join('record', `${authUser}.json`));
            desiredList = desired || [];
        } else {
            desiredList = await getJson(DESIRE_FILE_NAME);
        }

        // OPTIMIZATION: Use a Set for fast O(1) lookups
        const desiredSet = new Set(desiredList);

        // OPTIMIZATION: Process all files in parallel with a shared limiter
        let prompts = []

        for (const group of configGroups) {
            for (const m of group.members) {
                // Check if this member is desired
                const isQueryMatch = member && m.name === member;
                const isDesiredListMatch = !member && desiredSet.has(m.name); // Only check set if no specific member query

                if (isQueryMatch || isDesiredListMatch) {
                    try {
                        const memberDir = path.join(RECORD_FILE_PATH, group.name, m.name);
                        const messagesJsonPath = path.join(memberDir, `${m.id}_timeline_messages.json`);
                        const existingMessages = await getJson(messagesJsonPath);
                        if (existingMessages.length === 0) {
                            continue; // This member has no messages, skip
                        }
                        for (const msg of existingMessages) {
                            const msgDate = new Date(msg.published_at);
                            // Filter by date
                            if (cutoffDate && msgDate < cutoffDate) {
                                continue;
                            }
                            if (!msg.text) {
                                continue;
                            }
                            prompts.push({
                                member: m.name,
                                published_at: new Date(msg.published_at),
                                text: msg.text || ''
                            });
                        }
                    } catch (err) {
                        console.error(`Failed to process member ${m.name}:`, err.message);
                    }
                }
            }
        }
        prompts = prompts.sort((a, b) => b.published_at - a.published_at);
        const jsonPayload = JSON.stringify(prompts);
        res.set({
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': 'attachment; filename="messages.json"'
        });
        res.send(Buffer.from(jsonPayload, 'utf8'));
    } catch (err) {
        next(err); // Pass error to global handler
    }
};
