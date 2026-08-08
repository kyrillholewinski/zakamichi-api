import fs from 'fs';
import path from 'path';
import { getJson } from '../../utils/file.js';

const TV_PROGRAM_FILE = path.join('record', 'tv_programs.json');

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SCHEDULE_TYPES = ['weekly', 'weekly-ura'];

// Seed data replicating the programs that used to be hardcoded in the frontend.
// URL templates support {ep} (raw number) and {ep:N} (zero-padded to N digits).
const DEFAULT_PROGRAMS = [
    {
        id: 'hinaai',
        title: '日向坂で会いましょう',
        scheduleType: 'weekly',
        anchorDate: '2026-05-18',
        anchorEpisode: 363,
        intervalDays: 7,
        urlTemplate: 'https://pub-afd85e4b782042e3b1856c07d0f93ccd.r2.dev/hinaai{ep:3}.mp4',
        uraUrlTemplate: null,
        altUrlTemplate: 'https://storage.h46sub.cc/h46sub//hinaai{ep:3}.mp4',
        altMaxEpisode: 310,
        startEpisode: null,
        endEpisode: null,
        finalHasUra: null,
    },
    {
        id: 'hinanari',
        title: '日向坂になりましょう',
        scheduleType: 'weekly-ura',
        anchorDate: '2026-05-07',
        anchorEpisode: 22,
        intervalDays: 7,
        urlTemplate: 'https://pub-afd85e4b782042e3b1856c07d0f93ccd.r2.dev/hinanari5ki{ep:2}.mp4',
        uraUrlTemplate: 'https://pub-afd85e4b782042e3b1856c07d0f93ccd.r2.dev/hinanari5ki{ep:2}ura.mp4',
        altUrlTemplate: null,
        altMaxEpisode: null,
        startEpisode: null,
        endEpisode: null,
        finalHasUra: true,
    },
];

const writePrograms = async (programs) => {
    await fs.promises.writeFile(TV_PROGRAM_FILE, JSON.stringify(programs, null, 4), 'utf-8');
};

const loadPrograms = async () => {
    const programs = await getJson(TV_PROGRAM_FILE, null);
    if (!Array.isArray(programs)) {
        await writePrograms(DEFAULT_PROGRAMS);
        return DEFAULT_PROGRAMS;
    }
    return programs;
};

const toOptionalInt = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const n = parseInt(value, 10);
    return Number.isNaN(n) ? NaN : n;
};

// Accepts real booleans as well as the 'true'/'false' strings a form may send.
const toBool = (value, fallback) => {
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    return value === 'true' || value === '1';
};

const isValidTemplate = (tpl) =>
    typeof tpl === 'string' && /^https?:\/\//.test(tpl) && /\{ep(:\d+)?\}/.test(tpl);

// Validates the request body and returns { error } or { program }.
const sanitizeProgram = (body) => {
    const {
        id, title, scheduleType, anchorDate, urlTemplate, uraUrlTemplate, altUrlTemplate,
    } = body;

    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
        return { error: 'id must be 1-32 chars: lowercase letters, numbers, _ or - (starting with a letter or number)' };
    }
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 100) {
        return { error: 'title is required (max 100 chars)' };
    }
    if (!SCHEDULE_TYPES.includes(scheduleType)) {
        return { error: `scheduleType must be one of: ${SCHEDULE_TYPES.join(', ')}` };
    }
    if (typeof anchorDate !== 'string' || !DATE_PATTERN.test(anchorDate) || isNaN(new Date(anchorDate))) {
        return { error: 'anchorDate must be a valid YYYY-MM-DD date' };
    }

    const anchorEpisode = toOptionalInt(body.anchorEpisode);
    if (!anchorEpisode || anchorEpisode < 1) {
        return { error: 'anchorEpisode must be a positive integer' };
    }
    const intervalDays = toOptionalInt(body.intervalDays) ?? 7;
    if (Number.isNaN(intervalDays) || intervalDays < 1 || intervalDays > 60) {
        return { error: 'intervalDays must be an integer between 1 and 60' };
    }

    if (!isValidTemplate(urlTemplate)) {
        return { error: 'urlTemplate must be an http(s) URL containing {ep} or {ep:N}' };
    }
    if (scheduleType === 'weekly-ura' && !isValidTemplate(uraUrlTemplate)) {
        return { error: 'uraUrlTemplate is required for weekly-ura programs and must contain {ep} or {ep:N}' };
    }

    const altMaxEpisode = toOptionalInt(body.altMaxEpisode);
    if (Number.isNaN(altMaxEpisode) || (altMaxEpisode !== null && altMaxEpisode < 1)) {
        return { error: 'altMaxEpisode must be a positive integer' };
    }
    if (altMaxEpisode !== null && !isValidTemplate(altUrlTemplate)) {
        return { error: 'altUrlTemplate must contain {ep} or {ep:N} when altMaxEpisode is set' };
    }

    // Optional first episode — some programs are numbered from something other
    // than 1 (a renumbered season, or only part of a run being hosted).
    const startEpisode = toOptionalInt(body.startEpisode);
    if (Number.isNaN(startEpisode) || (startEpisode !== null && startEpisode < 1)) {
        return { error: 'startEpisode must be a positive integer (or empty to start at 1)' };
    }
    if (startEpisode !== null && startEpisode > anchorEpisode) {
        return { error: 'startEpisode cannot be greater than anchorEpisode' };
    }

    const endEpisode = toOptionalInt(body.endEpisode);
    if (Number.isNaN(endEpisode) || (endEpisode !== null && endEpisode < 1)) {
        return { error: 'endEpisode must be a positive integer (or empty for ongoing programs)' };
    }
    if (endEpisode !== null && endEpisode < anchorEpisode) {
        return { error: 'endEpisode cannot be earlier than anchorEpisode' };
    }
    if (endEpisode !== null && startEpisode !== null && endEpisode < startEpisode) {
        return { error: 'endEpisode cannot be earlier than startEpisode' };
    }

    return {
        program: {
            id,
            title: title.trim(),
            scheduleType,
            anchorDate,
            anchorEpisode,
            intervalDays,
            urlTemplate,
            uraUrlTemplate: scheduleType === 'weekly-ura' ? uraUrlTemplate : null,
            altUrlTemplate: altMaxEpisode !== null ? altUrlTemplate : null,
            altMaxEpisode,
            startEpisode,
            endEpisode,
            // Whether the last episode also got an ura (裏) airing. Only
            // meaningful for weekly-ura programs that have an end episode.
            finalHasUra: scheduleType === 'weekly-ura' ? toBool(body.finalHasUra, true) : null,
        },
    };
};

// GET /api/tvprogram
export const listTVPrograms = async (_req, res) => {
    try {
        const programs = await loadPrograms();
        return res.json({ success: true, data: programs });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

// POST /api/tvprogram  (admin only) — creates or updates a program by id
export const saveTVProgram = async (req, res) => {
    try {
        const { error, program } = sanitizeProgram(req.body || {});
        if (error) {
            return res.status(400).json({ success: false, error });
        }
        const programs = await loadPrograms();
        const index = programs.findIndex((p) => p.id === program.id);
        if (index >= 0) {
            programs[index] = program;
        } else {
            programs.push(program);
        }
        await writePrograms(programs);
        return res.json({ success: true, data: programs });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

// DELETE /api/tvprogram/:id  (admin only)
export const deleteTVProgram = async (req, res) => {
    try {
        const { id } = req.params;
        const programs = await loadPrograms();
        const remaining = programs.filter((p) => p.id !== id);
        if (remaining.length === programs.length) {
            return res.status(404).json({ success: false, error: 'Program not found' });
        }
        await writePrograms(remaining);
        return res.json({ success: true, data: remaining });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
};
