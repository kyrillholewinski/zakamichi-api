import path from 'path';

const RECORD_DIR = 'record';

// Usernames map directly to filenames, so restrict them to a safe charset.
const USERNAME_RE = /^[A-Za-z0-9_-]{1,32}$/;

export const isValidUsername = (u) => typeof u === 'string' && USERNAME_RE.test(u);

/**
 * Build the on-disk path for a user's record, rejecting anything that could
 * escape the record directory (path traversal). Throws on invalid input so
 * callers can map it to a 400.
 *
 * @param {string} username
 * @returns {string} e.g. "record/alice.json"
 */
export const safeRecordPath = (username) => {
    if (!isValidUsername(username)) {
        const err = new Error('Invalid username');
        err.statusCode = 400;
        throw err;
    }
    // basename is belt-and-suspenders on top of the charset check above.
    return path.join(RECORD_DIR, `${path.basename(username)}.json`);
};
