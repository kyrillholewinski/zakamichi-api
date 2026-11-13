import os from 'os';
import path from 'path';
import pLimit from 'p-limit';
import htmlParser from 'node-html-parser';

import { getJson } from '../../utils/file.js';
import { parseDateTime } from '../../utils/date.js';
import { getAllBlogMembers, getBlogHtmlContent, GROUP_CONFIG } from './blog.js';
import { RECORD_FILE_PATH, CONFIG_FILE_NAME } from '../../config/config.js';

const PROCESSOR_THREADS = os.availableParallelism() || 4;
const EXCLUDED_MEMBERS = new Set(['運営スタッフ']);

// Messages and blogs name groups differently: message config uses the display
// name ('乃木坂46'); blog records use an id ('Nogizaka46') whose display name
// lives in GROUP_CONFIG. Everything here is keyed by the display name.
const blogGroupDisplayName = (blogGroupId) => GROUP_CONFIG[blogGroupId]?.name || blogGroupId;

/**
 * GET /api/prompt/members
 * Every group with the union of members that have messages and/or blogs.
 */
export const getPromptMembers = async (_req, res, next) => {
    try {
        const groups = new Map(); // display name -> Map(member -> { messages, blogs })
        const touch = (group, name) => {
            if (!name || EXCLUDED_MEMBERS.has(name)) return null;
            if (!groups.has(group)) groups.set(group, new Map());
            const members = groups.get(group);
            if (!members.has(name)) members.set(name, { name, messages: false, blogs: false });
            return members.get(name);
        };

        for (const g of await getJson(CONFIG_FILE_NAME)) {
            for (const m of g.members || []) {
                const entry = touch(g.name, m.name);
                if (entry) entry.messages = true;
            }
        }
        for (const m of await getAllBlogMembers()) {
            const entry = touch(blogGroupDisplayName(m.Group), m.Name);
            if (entry && (m.BlogList || []).length) entry.blogs = true;
        }

        const data = Array.from(groups, ([group, members]) => ({
            group,
            members: Array.from(members.values()),
        }));
        return res.json({ success: true, data });
    } catch (err) {
        next(err);
    }
};

/**
 * POST /api/prompt/combined  { group, member, all?, date? }
 * One JSON file merging the member's messages and blogs into a single timeline
 * (newest first, like the per-source prompt files). `all` (or no date) exports
 * the whole history; `date` (yyyyMMdd) keeps entries from that day onward.
 */
export const getCombinedPrompt = async (req, res, next) => {
    try {
        const { group, member, all, date } = req.body;
        if (!group || !member) {
            return res.status(400).json({ success: false, error: 'group and member are required' });
        }

        let cutoffDate = null;
        if (!all && date) {
            const parsed = new Date(parseDateTime(date, 'yyyyMMdd'));
            if (isNaN(parsed)) {
                return res.status(400).json({ success: false, error: 'date must be yyyyMMdd' });
            }
            cutoffDate = parsed;
        }
        const inRange = (d) => !isNaN(d) && (!cutoffDate || d >= cutoffDate);

        const entries = [];

        // ── Messages ─────────────────────────────────────────────────────────
        const msgGroup = (await getJson(CONFIG_FILE_NAME)).find(g => g.name === group);
        const msgMember = msgGroup?.members?.find(m => m.name === member);
        if (msgMember) {
            const messages = await getJson(
                path.join(RECORD_FILE_PATH, msgGroup.name, msgMember.name, `${msgMember.id}_timeline_messages.json`)
            );
            for (const msg of messages) {
                if (!msg.text) continue;
                const publishedAt = new Date(msg.published_at);
                if (!inRange(publishedAt)) continue;
                entries.push({ source: 'message', member, published_at: publishedAt, text: msg.text });
            }
        }

        // ── Blogs ────────────────────────────────────────────────────────────
        const blogMember = (await getAllBlogMembers())
            .find(m => m.Name === member && blogGroupDisplayName(m.Group) === group);
        if (blogMember) {
            const limit = pLimit(PROCESSOR_THREADS);
            await Promise.all((blogMember.BlogList || []).map(blog => limit(async () => {
                const publishedAt = new Date(blog.DateTime);
                if (!inRange(publishedAt)) return;
                const html = await getBlogHtmlContent(blog.ID, blogMember.Group);
                if (!html) return;
                entries.push({
                    source: 'blog',
                    member,
                    published_at: publishedAt,
                    id: blog.ID,
                    title: blog.Title,
                    text: htmlParser.parse(html).innerText.trim(),
                });
            })));
        }

        if (!msgMember && !blogMember) {
            return res.status(404).json({ success: false, error: 'Member not found' });
        }

        entries.sort((a, b) => b.published_at - a.published_at);

        const fileName = `prompt_${member}_${all || !date ? 'all' : date}.json`;
        res.set({
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': `attachment; filename="prompt.json"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        });
        res.send(Buffer.from(JSON.stringify(entries), 'utf8'));
    } catch (err) {
        next(err);
    }
};
