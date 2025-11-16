import archiver from 'archiver';
import path from 'path';
import fs from 'fs'; // Keep 'fs' for createReadStream
import { getJsonList } from '../../utils/file.js';
import { parseDateTime } from '../../utils/date.js';
import { RECORD_FILE_PATH, DEFAULT_TIMEZONE_OFFSET_MS, CONFIG_FILE_NAME, DESIRE_FILE_NAME } from '../../config/config.js';

/**
 * Asynchronously processes all messages for a single member.
 * It checks file existence and appends files to the archive in parallel.
 * @param {object} group - The group object
 * @param {object} m - The member object
 * @param {archiver.Archiver} archive - The archiver instance
 * @param {Date | null} cutoffDate - The date to filter messages
 * @param {string | null} memberQuery - The specific member from req.query
 */
async function processMemberMessages(group, m, archive, cutoffDate, memberQuery) {
    try {
        const memberDir = path.join(RECORD_FILE_PATH, group.name, m.name);
        const messagesJsonPath = path.join(memberDir, `${m.id}_timeline_messages.json`);

        const existingMessages = await getJsonList(messagesJsonPath);
        if (existingMessages.length === 0) {
            return; // This member has no messages, skip
        }

        const archivePathPrefix = memberQuery ? '' : path.join(group.name, m.name);
        for (const msg of existingMessages) {
            const msgDate = new Date(msg.published_at);

            // Filter by date
            if (cutoffDate && msgDate < cutoffDate) {
                continue;
            }

            // Skip if no file
            if (!msg.local_file) {
                continue;
            }

            // Push an async function to our promise array
            // This function checks for the file and appends it
            try {
                // ASYNC CHECK: Check for read access without blocking
                await fs.promises.access(msg.local_file, fs.constants.R_OK);
                // File exists, append it.
                // archive.append is non-blocking and handles the stream.
                const fileName = path.basename(msg.local_file);
                const fileDate = new Date(msgDate.getTime() + DEFAULT_TIMEZONE_OFFSET_MS);
                const archiveName = path.join(archivePathPrefix, fileName);
                console.log({ archiveName, fileDate })
                const data = fs.createReadStream(msg.local_file)
                archive.append(data, { name: archiveName, date: fileDate });

            } catch (fileErr) {
                // File doesn't exist or isn't readable, warn and skip
                if (fileErr.code === 'ENOENT') {
                    console.warn(`File not found, skipping: ${msg.local_file}`);
                } else {
                    console.error(`Error accessing file ${msg.local_file}:`, fileErr.message);
                }
            }
        }


    } catch (err) {
        console.error(`Failed to process member ${m.name}:`, err.message);
    }
}

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

        const cutoffDate = member ? null : lastUpdate;

        // Load configs
        const configGroups = await getJsonList(CONFIG_FILE_NAME);
        const desiredMembers = await getJsonList(DESIRE_FILE_NAME);

        // OPTIMIZATION: Use a Set for fast O(1) lookups
        const desiredSet = new Set(desiredMembers);

        // NOTE: zlib level 9 is max compression but slowest.
        // For faster speed, use level 6 (default) or 1 (fastest).
        const archive = archiver('zip', { zlib: { level: 9 } });

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

        res.attachment('Messages.zip');
        archive.pipe(res);

        // OPTIMIZATION: Process all members in parallel
        const processingPromises = [];

        for (const group of configGroups) {
            for (const m of group.members) {
                // Check if this member is desired
                const isQueryMatch = member && m.name === member;
                const isDesiredListMatch = !member && desiredSet.has(m.name); // Only check set if no specific member query

                if (isQueryMatch || isDesiredListMatch) {
                    console.log(`Processing member ${m.name}`);
                    // Add this member's processing task to the promise array
                    processingPromises.push(
                        processMemberMessages(group, m, archive, cutoffDate, member)
                    );
                }
            }
        }

        // Wait for all members to be processed in parallel
        await Promise.all(processingPromises);

        // All files have been appended, finalize the archive.
        await archive.finalize();

    } catch (err) {
        next(err); // Pass error to global handler
    }
};