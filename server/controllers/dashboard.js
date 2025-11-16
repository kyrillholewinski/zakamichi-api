import path from 'path';
import { getJsonList } from '../../utils/file.js';
import { RECORD_FILE_PATH, CONFIG_FILE_NAME } from '../../config/config.js';

export const getDashboard = async (req, res, next) => {
    const { group, member, limit = 20, page = 1 } = req.query;
    const nLimit = parseInt(limit, 10);
    const nPage = parseInt(page, 10);

    try {
        const configGroups = await getJsonList(CONFIG_FILE_NAME);
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
                    const msgPath = path.join(memberDir, `${m.id}_timeline_messages.json`);
                    const memberInfoPath = path.join(memberDir, `${m.id}_members.json`);

                    // --- OPTIMIZATION: Fetch member's files in parallel ---
                    const [messages, memberInfos] = await Promise.all([
                        getJsonList(msgPath),      // Read messages
                        getJsonList(memberInfoPath) // Read member info
                    ]);

                    const member_info = memberInfos.length > 0 ? memberInfos[0] : {};

                    // --- NOTE: This is still a performance bottleneck if files are large ---
                    // See "Further Considerations" below.
                    messages.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
                    const startIndex = (nPage - 1) * nLimit;
                    const endIndex = nPage * nLimit;
                    const paginatedMessages = messages.slice(startIndex, endIndex);
                    const has_more = endIndex < messages.length;

                    // Return the data for this member
                    return {
                        member: m.name,
                        member_id: m.id,
                        message_count: messages.length,
                        thumbnail: member_info.thumbnail,
                        phone_image: member_info.phone_image,
                        has_more,
                        recent_messages: paginatedMessages.map(msg => ({
                            id: msg.id,
                            published_at: msg.published_at,
                            text: msg.text?.slice(0, 200) || '',
                            local_file: msg.local_file || null,
                            type: msg.type,
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