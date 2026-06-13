import bcrypt from 'bcryptjs';

const COST = 12;

// bcrypt hashes start with $2a$ / $2b$ / $2y$ — used to detect already-migrated records.
export const isHashed = (str) => typeof str === 'string' && /^\$2[aby]\$/.test(str);

export const hashPassword = (plain) => bcrypt.hashSync(String(plain), COST);

/**
 * Verify a candidate password against a user record, transparently migrating
 * legacy plaintext passwords to bcrypt on the first successful match.
 *
 * @param {object} record - the user record (its `password` field is read/updated in place)
 * @param {string} candidate - the password supplied by the client
 * @returns {{ ok: boolean, upgraded: boolean }} - `upgraded` means the caller must persist `record`
 */
export const verifyAndUpgrade = (record, candidate) => {
    const stored = record?.password;
    if (typeof stored !== 'string' || typeof candidate !== 'string') {
        return { ok: false, upgraded: false };
    }

    if (isHashed(stored)) {
        return { ok: bcrypt.compareSync(candidate, stored), upgraded: false };
    }

    // Legacy plaintext path: constant-effort compare, then re-hash on success.
    if (stored === candidate) {
        record.password = hashPassword(candidate);
        return { ok: true, upgraded: true };
    }
    return { ok: false, upgraded: false };
};
