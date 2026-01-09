import archiver from 'archiver';
import path from 'path';
import fs from 'fs';
import os from 'os';
import pLimit from 'p-limit';
import { getJson } from '../../utils/file.js';
import { parseDateTime } from '../../utils/date.js';
import { MESSAGE_BOT_PATH, RECORD_FILE_PATH, DEFAULT_TIMEZONE_OFFSET_MS, CONFIG_FILE_NAME, DESIRE_FILE_NAME } from '../../config/config.js';

const PROCESSOR_THREADS = os.availableParallelism() || 4;

export const getMessageDashboard = async (req, res, next) => {
    const { group, member, limit = 20, page = 1 } = req.body;
    const nLimit = parseInt(limit, 10);
    const nPage = parseInt(page, 10);
    const includeRecentMessages = Boolean(member);

    try {
        const configGroups = await getJson(CONFIG_FILE_NAME);
        if (!configGroups.length) {
            return res.status(404).json({ error: 'No groups found' });
        }

        const dashboardData = [];
        // Groups are still processed sequentially, which is fine.
        for (const g of configGroups) {
            if (group && g.name !== group) continue;
            // --- OPTIMIZATION: Filter members before processing ---
            const membersToProcess = g.members.filter(m => !member || m.name === member);

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
                        const messages = await getJson(msgPath);
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

export const getMessagesZip = async (req, res, next) => {
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
        const archive = archiver('zip', { zlib: { level: 1 } });

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
            res.status(500).send({ error: err.message });
        });

        res.attachment('Message.zip');
        archive.pipe(res);

        const limit = pLimit(PROCESSOR_THREADS);

        // OPTIMIZATION: Process all files in parallel with a shared limiter
        const appendTasks = [];

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
                                try {
                                    // ASYNC CHECK: Check for read access without blocking
                                    await fs.promises.access(fileName, fs.constants.R_OK);
                                    // File exists, append it.
                                    // archive.append is non-blocking and handles the stream.
                                    const data = fs.createReadStream(fileName, { highWaterMark: 64 * 1024 });
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
        await archive.finalize();

    } catch (err) {
        next(err); // Pass error to global handler
    }
};

export const getMessagesPrompt = async (req, res, next) => {
    try {
        const { member, date } = req.body;
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
