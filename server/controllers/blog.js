import fs from 'fs';
import path from 'path';
import os from 'os';
import archiver from 'archiver';
import pLimit from 'p-limit';
import htmlParser from 'node-html-parser';

import { getJson, ensureDirectoryExists } from "../../utils/file.js";
import { parseDateTime } from '../../utils/date.js';
import { loadUrlStream } from '../../utils/api.js';
import { BLOG_BOT_PATH, DESIRE_FILE_NAME } from "../../config/config.js";

// ==========================================
// 1. Configuration & Constants
// ==========================================

const PROCESSOR_THREADS = os.availableParallelism() || 4;
const SOURCE_EXTENSIONS = new Set(['.jpeg', '.jpg', '.png', '.gif']); // Set for O(1) lookup
const DEFAULT_LAST_UPDATE = new Date(2000, 1, 2);

// Enum for strict typing reference
const IdolGroup = Object.freeze({
    Nogizaka46: 'Nogizaka46',
    Sakurazaka46: 'Sakurazaka46',
    Hinatazaka46: 'Hinatazaka46',
    Keyakizaka46: 'Keyakizaka46',
    Bokuao: 'Bokuao',
});

// Centralized Configuration: Maps Group IDs to their specific settings
const GROUP_CONFIG = {
    [IdolGroup.Nogizaka46]: {
        url: 'https://nogizaka46.com',
        folderName: '◢乃木坂46'
    },
    [IdolGroup.Sakurazaka46]: {
        url: 'https://sakurazaka46.com',
        folderName: '◢櫻坂46'
    },
    [IdolGroup.Hinatazaka46]: {
        url: '',
        folderName: '◢日向坂46'
    },
    [IdolGroup.Keyakizaka46]: {
        url: '',
        folderName: 'Keyakizaka46' // Assuming default
    },
    [IdolGroup.Bokuao]: {
        url: '',
        folderName: '僕青'
    }
};

// File System Constants
const PATHS = {
    ROOT: BLOG_BOT_PATH,
    RECORD: 'record',
    CONTENT: 'blogContent',
    STATUS_FILE: 'BlogStatus.JSON'
};

// ==========================================
// 2. Helper Functions
// ==========================================

/**
 * Dynamically resolves the path for a specific group's record folder.
 */
const getGroupRecordPath = (groupName) => {
    return path.join(PATHS.ROOT, PATHS.RECORD, groupName);
};

/**
 * Retrieves the full list of members and their blogs from all groups.
 */
async function getAllBlogMembers() {
    const groups = Object.keys(GROUP_CONFIG);

    // Map groups to their status file path promise
    const promises = groups.map(group => {
        const filePath = path.join(getGroupRecordPath(group), PATHS.STATUS_FILE);
        return getJson(filePath);
    });

    const results = await Promise.all(promises);
    return results.flat();
}

/**
 * Reads HTML content for a specific blog.
 */
async function getBlogHtmlContent(blogId, groupName) {
    const contentFolderPath = path.join(PATHS.ROOT, PATHS.CONTENT, groupName);
    await ensureDirectoryExists(contentFolderPath);

    const htmlContentFilePath = path.join(contentFolderPath, `${blogId}.html`);

    try {
        await fs.promises.access(htmlContentFilePath, fs.constants.R_OK);
        return await fs.promises.readFile(htmlContentFilePath, 'utf-8', fs.constants.R_OK);
    } catch {
        return null;
    }
}

/**
 * Sanitizes filenames to avoid OS conflicts and handle duplicates.
 */
function sanitizeFileName(base, extension, id = "22350") {
    const cleanBase = base || '';
    // Handle generic sequence numbers often used by CMS
    const isGenericSequence = /^\d{4}$/.test(cleanBase);

    if (isGenericSequence) {
        return `${id}_${cleanBase}${extension}`;
    }

    // Truncate long filenames
    if (cleanBase.length > 52) {
        return cleanBase.substring(0, 52) + extension;
    }

    return cleanBase + extension;
}

// ==========================================
// 3. Controllers
// ==========================================

/**
 * GET /api/dashboard
 * Returns a summary of groups and members.
 */
export const getBlogDashboard = async (req, res, next) => {
    try {
        const allMembers = await getAllBlogMembers();

        // Use a Map for cleaner grouping
        const groupsMap = new Map();

        for (const member of allMembers) {
            const groupName = member.Group || 'Unknown';

            const groupConfig = GROUP_CONFIG[member.Group];
            const homePage = groupConfig?.url || '';

            if (!groupsMap.has(groupName)) {
                groupsMap.set(groupName, []);
            }

            // Calculate last update time efficiently
            let lastUpdateTime = null;
            let thumbnail = null
            if (member.BlogList?.length > 0) {
                // Assuming BlogList is usually chronological, but safe to sort
                const latestBlog = member.BlogList.reduce((prev, current) =>
                    (new Date(prev.DateTime) > new Date(current.DateTime)) ? prev : current
                );
                lastUpdateTime = latestBlog.DateTime;
                thumbnail = latestBlog.ImageList.length > 0 ? (homePage + latestBlog.ImageList[0]) : null
            }

            const m = {
                name: member.Name,
                group: groupName,
                thumbnail: thumbnail,
                blog_count: member.BlogList.length,
                last_update_time: lastUpdateTime
            }

            if (member.Name && member.Name != "運営スタッフ") {
                groupsMap.get(groupName).push(m);
            }
        }

        const dashboardData = Array.from(groupsMap, ([group, members]) => ({ group, members }));

        res.json(dashboardData);
    } catch (err) {
        next(err);
    }
};

/**
 * GET /api/blogs
 * Returns a paginated list of blogs.
 */
export const getBlogList = async (req, res, next) => {
    try {
        const { page = 1, limit = 20, member, group } = req.body;
        const nLimit = parseInt(limit, 10);
        const nPage = parseInt(page, 10);

        const allMembers = await getAllBlogMembers();
        let allBlogs = [];

        // Optimized filtering
        if (member && group) {
            const targetMember = allMembers.find(m => m.Name === member && m.Group === group);
            if (targetMember) {
                allBlogs = targetMember.BlogList.map(blog => ({
                    ...blog,
                    member_name: targetMember.Name,
                    group: targetMember.Group
                }));
            }
        } else {
            allBlogs = allMembers.flatMap(m =>
                m.BlogList.map(blog => ({
                    ...blog,
                    member_name: m.Name,
                    group: m.Group
                }))
            );
        }

        // Sort Descending
        allBlogs.sort((a, b) => new Date(b.DateTime) - new Date(a.DateTime));

        // Pagination
        const startIndex = (nPage - 1) * nLimit;
        const endIndex = nPage * nLimit;
        const paginatedBlogs = allBlogs.slice(startIndex, endIndex);

        res.json({
            list: paginatedBlogs,
            has_more: endIndex < allBlogs.length
        });

    } catch (err) {
        next(err);
    }
};

/**
 * GET /api/blog/detail
 * Returns HTML content for a specific blog.
 */
export const getBlogDetail = async (req, res, next) => {
    try {
        const { id, group } = req.body;

        if (!id || !group) {
            return res.status(400).json({ success: false, error: 'Blog ID and Group are required.' });
        }

        const htmlContent = await getBlogHtmlContent(id, group);

        if (htmlContent) {
            res.json({ htmlContent });
        } else {
            res.status(404).json({ success: false, error: 'Blog content not found.' });
        }
    } catch (err) {
        next(err);
    }
};

/**
 * GET /api/blogs/zip
 * Downloads images and streams a ZIP file.
 */
export const getBlogsZip = async (req, res, next) => {
    try {
        const { member, group, date, blogId } = req.query;

        // 1. Determine Cutoff Date
        let cutoffDate = null;
        if (date) {
            // If no specific member is selected, we might use a date filter
            const parsed = new Date(parseDateTime(date, 'yyyyMMdd'));
            cutoffDate = parsed || DEFAULT_LAST_UPDATE;
        } else {
            cutoffDate = DEFAULT_LAST_UPDATE;
        }

        // 2. Filter Members
        const allMembers = await getAllBlogMembers();
        const authUser = req.user?.user;
        let desiredList = [];
        if (authUser) {
            const userRecord = await getJson(path.join('record', `${authUser}.json`));
            desiredList = userRecord?.desired || [];
        } else {
            desiredList = await getJson(DESIRE_FILE_NAME);
        }

        let membersToProcess = [];
        if (member && group) {
            membersToProcess = allMembers.filter(m => m.Name === member && m.Group === group);
        } else {
            membersToProcess = allMembers.filter(m => desiredList.includes(m.Name));
        }

        if (!membersToProcess.length) {
            return res.status(404).json({ error: 'No matching members found' });
        }

        // 3. Initialize Archive Stream
        const archive = archiver('zip', { zlib: { level: 1 } });
        res.attachment('DCIM.zip');
        archive.pipe(res);

        // 4. Process Downloads
        // We flatten the process to download images concurrently across members/blogs
        const downloadTasks = prepareDownloadTasks(membersToProcess, cutoffDate, blogId);

        // Execute downloads with concurrency limit
        const limit = pLimit(PROCESSOR_THREADS);
        const downloadPromises = downloadTasks.map(task =>
            limit(() => executeDownloadTask(task, archive))
        );

        // Wait for all downloads to complete (resolves to objects or null)
        await Promise.all(downloadPromises);

        // 5. Finalize
        await archive.finalize();

        console.log('[EXPORT] Completed', {
            query: req.body,
            cutoffDate: cutoffDate?.toLocaleString("zh-TW", { timeZone: 'ROC' }) || 'None'
        });

    } catch (err) {
        console.error('❌ [EXPORT] Error:', err);
        // Only call next(err) if headers haven't been sent, otherwise stream is broken
        if (!res.headersSent) next(err);
    }
};

export const getBlogsPrompt = async (req, res, next) => {
    try {
        const { member, group, date, blogId } = req.body;
        // 1. Determine Cutoff Date
        let cutoffDate = null;
        if (date) {
            // If no specific member is selected, we might use a date filter
            const parsed = new Date(parseDateTime(date, 'yyyyMMdd'));
            cutoffDate = parsed || DEFAULT_LAST_UPDATE;
        } else {
            cutoffDate = DEFAULT_LAST_UPDATE;
        }

        // 2. Filter Members
        const allMembers = await getAllBlogMembers();
        const authUser = req.user?.user;
        let desiredList = [];
        if (authUser) {
            const userRecord = await getJson(path.join('record', `${authUser}.json`));
            desiredList = userRecord?.desired || [];
        } else {
            desiredList = await getJson(DESIRE_FILE_NAME);
        }
        let membersToProcess = [];
        if (member && group) {
            membersToProcess = allMembers.filter(m => m.Name === member && m.Group === group);
        } else {
            membersToProcess = allMembers.filter(m => desiredList.includes(m.Name));
        }
        if (!membersToProcess.length) {
            return res.status(404).json({ error: 'No matching members found' });
        }

        // Execute downloads with concurrency limit
        const limit = pLimit(PROCESSOR_THREADS);

        const processTasks = [];
        // 3. Prepare Prompts
        let prompts = [];

        for (const m of membersToProcess) {
            let blogList = m.BlogList || [];
            if (blogId) {
                blogList = blogList.filter(b => b.ID === blogId);
            } else if (cutoffDate) {
                blogList = blogList.filter(b => new Date(b.DateTime) >= cutoffDate);
            }

            processTasks.push(...blogList.map(blog =>
                limit(async () => {
                    const htmlContent = await getBlogHtmlContent(blog.ID, m.Group);
                    const blogDateTime = new Date(blog.DateTime);
                    if (htmlContent) {
                        const content = htmlContent ? htmlParser.parse(htmlContent)?.innerText : '';
                        prompts.push({
                            ID: blog.ID,
                            Title: blog.Title,
                            DateTime: blogDateTime,
                            Member: m.Name,
                            Content: content
                        })
                    }
                })
            ));
        }

        await Promise.all(processTasks);
        prompts = prompts.sort((a, b) => b.DateTime - a.DateTime);
        const jsonPayload = JSON.stringify(prompts);
        res.set({
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': 'attachment; filename="blogs.json"'
        });
        res.send(Buffer.from(jsonPayload, 'utf8'));
    } catch (err) {
        next(err);
    }
}

// ==========================================
// 4. Zip Utility Functions
// ==========================================

/**
 * Prepares a flat list of download tasks.
 * Does not download yet, just calculates URLs and paths.
 */
function prepareDownloadTasks(members, cutoffDate, targetBlogId) {
    const tasks = [];

    for (const member of members) {
        // Filter blogs
        let blogList = member.BlogList || [];

        if (targetBlogId) {
            blogList = blogList.filter(b => b.ID === targetBlogId);
        } else if (cutoffDate) {
            blogList = blogList.filter(b => new Date(b.DateTime) >= cutoffDate);
        }

        if (blogList.length === 0) continue;

        const groupConfig = GROUP_CONFIG[member.Group];
        const homePage = groupConfig?.url || '';
        const baseFolder = groupConfig?.folderName || 'Unknown';
        const memberImgFolder = path.join(baseFolder, member.Name);
        const tzOffsetMs = 8 * 60 * 60 * 1000; // UTC+8

        for (const blog of blogList) {
            const { DateTime, ImageList = [], ID } = blog;
            if (!ImageList.length) continue;
            const blogTimestamp = new Date(DateTime).getTime();
            // Filter only valid extensions
            const validImages = ImageList.filter(rel =>
                SOURCE_EXTENSIONS.has(path.extname(rel).toLowerCase())
            );

            // Prepare tasks
            for (const [index, imgPath] of validImages.entries()) {
                const ext = path.extname(imgPath).toLowerCase();
                const base = path.basename(imgPath, ext);
                const filename = sanitizeFileName(base, ext, ID);
                // Calculate file date with slight increment to avoid identical timestamps
                const fileDate = new Date(blogTimestamp + tzOffsetMs + index * 60 * 1000);
                // Create task object
                tasks.push({
                    url: `${homePage}${imgPath}`,
                    archivePath: path.join(memberImgFolder, filename),
                    date: fileDate,
                    memberName: member.Name
                });
            }
        }
    }
    return tasks;
}

/**
 * Executes the specific download task.
 * Returns formatted object for archiver or null on failure.
 */
async function executeDownloadTask(task, archive) {
    try {
        // Retry logic can be added inside loadUrlStream or here if needed
        const data = await loadUrlStream(task.url, 3);
        if (data) {
            archive.append(data, { name: task.archivePath, date: task.date });
        } else {
            throw new Error('Failed to load stream');
        }
    } catch (err) {
        console.warn(`✖ Failed: ${task.memberName} -> ${task.url} : ${err.message}`);
    }
}
