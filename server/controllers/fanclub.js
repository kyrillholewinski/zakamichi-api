import path from 'path';
import fs from 'fs';
import { getJson } from '../../utils/file.js';
import { getAllBlogMembers, GROUP_CONFIG } from './blog.js';

const writeUserRecord = async (username, data) => {
    const filePath = path.join('record', `${username}.json`);
    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 4), 'utf-8');
};

// GET /api/fanclub/profile
export const getUserProfile = async (req, res) => {
    try {
        const { user: authUser, role } = req.user;
        const userRecord = await getJson(path.join('record', `${authUser}.json`));
        return res.json({
            success: true,
            data: {
                username: authUser,
                role,
                desired: userRecord.desired || [],
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

// GET /api/fanclub/members
export const getAllMembers = async (_req, res) => {
    try {
        const allMembers = await getAllBlogMembers();
        if (!allMembers.length) {
            return res.status(404).json({ success: false, error: 'No members found' });
        }
        const groupsMap = new Map();
        for (const m of allMembers) {
            if (!m.Name || m.Name === '運営スタッフ') continue;
            if (!groupsMap.has(m.Group)) groupsMap.set(m.Group, []);
            groupsMap.get(m.Group).push({ name: m.Name });
        }
        const groups = Array.from(groupsMap, ([groupId, members]) => ({
            group: GROUP_CONFIG[groupId]?.name || groupId,
            members
        }));
        return res.json({ success: true, data: groups });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

// POST /api/fanclub/desired
export const updateDesired = async (req, res) => {
    try {
        const { user: authUser } = req.user;
        const { desired } = req.body;
        if (!Array.isArray(desired)) {
            return res.status(400).json({ success: false, error: 'desired must be an array' });
        }
        const filePath = path.join('record', `${authUser}.json`);
        const userRecord = await getJson(filePath);
        userRecord.desired = desired;
        await writeUserRecord(authUser, userRecord);
        return res.json({ success: true, message: 'Desired list updated' });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

// POST /api/fanclub/password
export const updatePassword = async (req, res) => {
    try {
        const { user: authUser } = req.user;
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, error: 'currentPassword and newPassword are required' });
        }
        const filePath = path.join('record', `${authUser}.json`);
        const userRecord = await getJson(filePath);
        if (userRecord.password !== currentPassword) {
            return res.status(401).json({ success: false, error: 'Current password is incorrect' });
        }
        userRecord.password = newPassword;
        await writeUserRecord(authUser, userRecord);
        return res.json({ success: true, message: 'Password updated successfully' });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

// GET /api/fanclub/users  (admin only)
export const getUsers = async (_req, res) => {
    try {
        const recordDir = 'record';
        const files = await fs.promises.readdir(recordDir);
        const userFiles = files.filter(f => f.endsWith('.json'));
        const users = await Promise.all(userFiles.map(async (file) => {
            const username = file.replace('.json', '');
            const record = await getJson(path.join(recordDir, file));
            return {
                username,
                role: record.role || 'guest',
                desiredCount: (record.desired || []).length,
            };
        }));
        return res.json({ success: true, data: users });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

// POST /api/fanclub/users  (admin only)
export const createUser = async (req, res) => {
    try {
        const { username, password, role } = req.body;
        if (!username || !password || !role) {
            return res.status(400).json({ success: false, error: 'username, password, and role are required' });
        }
        if (!['admin', 'guest'].includes(role)) {
            return res.status(400).json({ success: false, error: 'role must be admin or guest' });
        }
        const filePath = path.join('record', `${username}.json`);
        try {
            await fs.promises.access(filePath);
            return res.status(409).json({ success: false, error: 'User already exists' });
        } catch {
            // File doesn't exist — proceed
        }
        const newUser = { password, role, desired: [], ignore: [] };
        await fs.promises.writeFile(filePath, JSON.stringify(newUser, null, 4), 'utf-8');
        return res.json({ success: true, message: 'User created successfully' });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

// DELETE /api/fanclub/users/:username  (admin only)
export const deleteUser = async (req, res) => {
    try {
        const { username } = req.params;
        const { user: authUser } = req.user;
        if (username === authUser) {
            return res.status(400).json({ success: false, error: 'Cannot delete your own account' });
        }
        const filePath = path.join('record', `${username}.json`);
        try {
            await fs.promises.access(filePath);
        } catch {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        await fs.promises.unlink(filePath);
        return res.json({ success: true, message: 'User deleted successfully' });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};
