import archiver from 'archiver';
import { getJsonList } from "../../utils/file.js";
import path from 'path'
import { BLOG_BOT_PATH } from "../../config/config.js";
import { ensureDirectoryExists } from "../../utils/file.js";
import { parseDateTime } from '../../utils/date.js';
import fs from 'fs'
import { loadUrlStream } from '../../utils/api.js';
import pLimit from 'p-limit';
import os from 'os';
import { DESIRE_FILE_NAME } from '../../config/config.js';
const processorThread = os.cpus().length;

// Home pages
 const Keyakizaka46_HomePage = 'https://keyakizaka46.com';
 const Sakurazaka46_HomePage = 'https://sakurazaka46.com';
 const Hinatazaka46_HomePage = 'https://hinatazaka46.com';
 const Nogizaka46_HomePage = 'https://nogizaka46.com';
 const Bokuao_HomePage = 'https://bokuao.com';


// An enumeration for idol groups
 const IdolGroup = Object.freeze({
    Nogizaka46: 'Nogizaka46',
    Sakurazaka46: 'Sakurazaka46',
    Hinatazaka46: 'Hinatazaka46',
    Keyakizaka46: 'Keyakizaka46',
    Bokuao: 'Bokuao',
});
const sourceExtensions = ['.jpeg', '.jpg', '.png', '.gif'];

// Folder paths, mirroring your .NET code
// IMPORTANT: Assumes your 'record' folder is in the root of this server project.
// If it's elsewhere, you may need to adjust 'BootPath'
 const BootPath = BLOG_BOT_PATH;
 const Record = 'record'
 const Hinatazaka46_Images_FilePath = path.join(BootPath, Record, IdolGroup.Hinatazaka46);
 const Sakurazaka46_Images_FilePath = path.join(BootPath, Record, IdolGroup.Sakurazaka46);
 const Nogizaka46_Images_FilePath = path.join(BootPath, Record, IdolGroup.Nogizaka46);
 const Bokuao_Images_FilePath = path.join(BootPath, Record, IdolGroup.Bokuao);
 const BlogContent = 'blogContent'

 const BlogStatus_FilePath = 'BlogStatus.JSON';
 const Hinatazaka46_BlogStatus_FilePath = path.join(Hinatazaka46_Images_FilePath, BlogStatus_FilePath);
 const Sakurazaka46_BlogStatus_FilePath = path.join(Sakurazaka46_Images_FilePath, BlogStatus_FilePath);
 const Nogizaka46_BlogStatus_FilePath = path.join(Nogizaka46_Images_FilePath, BlogStatus_FilePath);
 const Bokuao_BlogStatus_FilePath = path.join(Bokuao_Images_FilePath, BlogStatus_FilePath);


// Helper to load all blog data from all groups
async function getAllBlogMembers() {
    const [
        hinataBlogs,
        sakuraBlogs,
        nogiBlogs,
        bokuaoBlogs
    ] = await Promise.all([
        getJsonList(Hinatazaka46_BlogStatus_FilePath),
        getJsonList(Sakurazaka46_BlogStatus_FilePath),
        getJsonList(Nogizaka46_BlogStatus_FilePath),
        getJsonList(Bokuao_BlogStatus_FilePath)
    ]);
    return [...hinataBlogs, ...sakuraBlogs, ...nogiBlogs, ...bokuaoBlogs];
}


async function getBlogHtmlContent(blogId, groupName) {
    const contentFolderPath = path.join(BootPath, BlogContent, groupName);
    await ensureDirectoryExists(contentFolderPath)
    const htmlContentFilePath = path.join(contentFolderPath, `${blogId}.html`);
    try {
        await fs.promises.access(htmlContentFilePath);
        return await fs.promises.readFile(htmlContentFilePath, 'utf-8'); // Specify encoding
    } catch {
        return null;
    }
}

export const getBlogDashboard = async (req, res, next) => {
    try {
        const allMembers = await getAllBlogMembers();

        const dashboardData = [];

        // Group members by their group
        const membersByGroup = allMembers.reduce((acc, member) => {
            const groupName = member.Group || 'Unknown';
            if (!acc[groupName]) {
                acc[groupName] = [];
            }

            // Find the most recent blog to get the last update time
            let last_update_time = null;
            if (member.BlogList && member.BlogList.length > 0) {
                // Sort by date to find the latest
                const sortedBlogs = [...member.BlogList].sort((a, b) => new Date(b.DateTime) - new Date(a.DateTime));
                last_update_time = sortedBlogs[0].DateTime;
            }

            acc[groupName].push({
                member_id: `${groupName}-${member.Name}`, // Create a simple unique ID
                name: member.Name,
                group: groupName,
                thumbnail: member.thumbnail || null, // Use thumbnail if it exists in the JSON
                blog_count: member.BlogList.length,
                last_update_time: last_update_time
            });
            return acc;
        }, {});

        // Convert the grouped object into the array format the UI expects
        for (const [groupName, members] of Object.entries(membersByGroup)) {
            dashboardData.push({
                group: groupName,
                members: members
            });
        }

        res.json({ success: true, data: dashboardData });

    } catch (err) {
        next(err);
    }
};



// Controller for GET /api/blogs
export const getBlogList = async (req, res, next) => {
    try {
        const { page = 1, limit = 20, member, group } = req.query;
        const nLimit = parseInt(limit, 10);
        const nPage = parseInt(page, 10);

        const allMembers = await getAllBlogMembers();
        let allBlogs = [];

        if (member && group) {
            // --- Filter by a specific member ---
            const foundMember = allMembers.find(m => m.Name === member && m.Group === group);
            if (foundMember) {
                allBlogs = foundMember.BlogList.map(blog => ({
                    ...blog,
                    member_name: foundMember.Name,
                    group: foundMember.Group
                }));
            }
        } else {
            // --- Get all blogs from all members ---
            allBlogs = allMembers.flatMap(member =>
                member.BlogList.map(blog => ({
                    ...blog,
                    member_name: member.Name,
                    group: member.Group
                }))
            );
        }

        // Sort all blogs by date, newest first (for a traditional blog list)
        allBlogs.sort((a, b) => new Date(b.DateTime) - new Date(a.DateTime));

        const startIndex = (nPage - 1) * nLimit;
        const endIndex = nPage * nLimit;
        const paginatedBlogs = allBlogs.slice(startIndex, endIndex);
        const has_more = endIndex < allBlogs.length;

        res.json({
            success: true,
            data: paginatedBlogs,
            has_more: has_more
        });

    } catch (err) {
        next(err);
    }
};

// Controller for GET /api/blog/
export const getBlogDetail = async (req, res, next) => {
    try {
        const { id,group } = req.query; // Group is needed to find the HTML file

        if (!id || !group) {
            return res.status(400).json({ success: false, error: 'Blog ID and Group are required.' });
        }

        const blogContent = await getBlogHtmlContent(id, group);

        if (blogContent) {
            res.json({ success: true, data: { htmlContent: blogContent } });
        } else {
            res.status(404).json({ success: false, error: 'Blog content not found.' });
        }
    } catch (err) {
        next(err);
    }
};

export const getBlogsZip = async (req,res,next) =>{
    try {
        const { member, group, date, blogId } = req.query;
        // 1) determine cutoff date
        const defaultDate = new Date(2000, 1, 2)
        let lastUpdate = defaultDate;
        if (date) {
            const parsed = new Date(parseDateTime(date, 'yyyyMMdd'));
            if (!isNaN(parsed)) lastUpdate = parsed;
        }

        const cutoffDate = member ? null : lastUpdate

        // 2) refresh all blogs

        // 3) pick members to export
        const allMembers = await getAllBlogMembers();
        const desired = await getJsonList(DESIRE_FILE_NAME);

        // if ?member=Name, only that one; otherwise all desired
        const memberBlogsToExport = member
            ? allMembers.filter(m => m.Name === member && m.Group === group)
            : allMembers.filter(m => desired.includes(m.Name));

        const blogsToExport = blogId
            ? memberBlogsToExport.map(m => ({ Group: m.Group, Name: m.Name, BlogList: m.BlogList.filter(b => b.ID === blogId) }))
            : memberBlogsToExport

        if (!blogsToExport.length) {
            return res.status(404).json({ error: 'No matching members found' });
        }

        // 4) stream zip
        const archive = archiver('zip', { zlib: { level: 9 } });
        res.attachment('DCIM.zip');
        archive.pipe(res);

        // 5) for each member, append their images
        const archiveEntries = await Promise.all(
            blogsToExport.map(m => appendBlogImagesToArchive(m, cutoffDate))
        );

        archiveEntries.flat().forEach(({ data, name, date }) => {
            archive.append(data, { name, date });
        });

        // 6) finalize
        await archive.finalize();
        console.log('[EXPORT]', {
            ...req.query,
            fileCount: archiveEntries.flat().length,
            //fileSize: formatBytes(archiveEntries.flat().reduce((partialSum, a) => partialSum + a.data.length, 0)),
            cutoffDate: cutoffDate?.toLocaleString("zh-TW", { timeZone: 'ROC' })
        });

    } catch (err) {
        console.error('❌ [EXPORT] error:', err);
        next(err);
    }
};

async function appendBlogImagesToArchive(member, lastUpdate = null) {
    // 1) Filter blogs by date
    const blogList = filterBlogListByDate(member.BlogList, lastUpdate);
    if (blogList.length === 0) return [];

    // 2) Initialize p-limit and setup constants
    const limit = pLimit(processorThread); // Limit to 5 concurrent downloads
    const archivePromises = [];
    const homePage = getHomePageByGroup(member.Group);
    const folderName = getFolderNameByGroup(member.Group);
    const imgFolder = path.join(folderName, member.Name);
    const tzOffsetMs = 8 * 60 * 60 * 1000; // UTC+8

    // 3) Iterate through all blogs and images to create a flat list of download tasks
    for (const blog of blogList) {
        const { DateTime, ImageList = [], Name, Title, ID } = blog;
        if (ImageList.length === 0) continue;

        const blogDatetime = new Date(DateTime).getTime();
        const validImages = ImageList.filter(rel => sourceExtensions.includes(path.extname(rel).toLowerCase()));

        for (const rel of validImages) {
            // Define all variables for the task inside the loop
            const url = `${homePage}${rel}`;
            const ext = path.extname(rel).toLowerCase();
            const base = path.basename(rel, ext);
            const filename = sanitizeFileName(base, ext, ID);
            const archivePath = path.join(imgFolder, filename);
            const fileDate = new Date(blogDatetime + tzOffsetMs);

            // Create a limited task and push its promise to the central array
            const limitedTask = limit(async () => {
                try {
                    const data = await loadUrlStream(url, 3);
                    if (!data) throw new Error('No data');
                    return { data, name: archivePath, date: fileDate };
                } catch (err) {
                    console.warn(`✖ ${member.Name} → ${url} failed: ${err.message}`);
                    allImagesSucceeded = false; // Mark failure for this blog
                    return null;
                }
            });
            archivePromises.push(limitedTask);
        }

        // This logging is trickier in a fully parallel model, but we can manage
        // by awaiting just the promises for the current blog.
        // NOTE: This approach slightly changes the pure "flattened" model but retains per-blog logging.
        // For pure flattening, you would remove this block and the `allImagesSucceeded` logic.
        (async () => {
            const blogResults = await Promise.all(archivePromises.slice(-validImages.length));
            if (blogResults.every(r => r !== null)) {
                console.log(
                    `Saved ${Name} blog [${Title}] ${new Date(blogDatetime).toLocaleString("ja-JP", { timeZone: 'Japan' })} ImageCount:${validImages.length}`
                );
            }
        })();
    }

    // 4) Await all throttled promises and collect successful results
    const results = await Promise.all(archivePromises);
    const archiveList = results.filter(r => r !== null);

    console.log(`✅ ${member.Name}: ${archiveList.length} images ready to archive`);
    return archiveList;
}

function getFolderNameByGroup(group) {
    const map = {
        [IdolGroup.Nogizaka46]: '◢乃木坂46',
        [IdolGroup.Sakurazaka46]: '◢櫻坂46',
        [IdolGroup.Hinatazaka46]: '◢日向坂46',
        [IdolGroup.Bokuao]: '僕青',
    };
    return map[group] || 'Unknown';
}

function getHomePageByGroup(group) {
    const map = {
        [IdolGroup.Nogizaka46]: Nogizaka46_HomePage,
        [IdolGroup.Sakurazaka46]: Sakurazaka46_HomePage,
    };
    return map[group] || '';
}


function filterBlogListByDate(blogList, lastUpdate) {
    if (!lastUpdate) return blogList;
    const cutoff = new Date(lastUpdate);
    return blogList.filter((b) => new Date(b.DateTime) >= cutoff);
}

function sanitizeFileName(base, extension, id = "22350") {
    if (!base) base = '';
    const fileExamples = ['0000', '0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008', '0009'];
    if (fileExamples.includes(base)) {
        return `${id}_${base}${extension}`;
    } else if (base.length > 52) {
        return base.substring(0, 52) + extension;
    }
    return base + extension;
}
