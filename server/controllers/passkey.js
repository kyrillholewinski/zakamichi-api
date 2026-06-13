import fs from 'fs';
import jwt from 'jsonwebtoken';
import {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { getJson } from '../../utils/file.js';
import { safeRecordPath } from '../../utils/validate.js';
import {
    JWT_SECRET,
    WEBAUTHN_RP_ID,
    WEBAUTHN_RP_NAME,
    WEBAUTHN_ORIGINS,
    COOKIE_SECURE,
} from '../../config/config.js';

const RECORD_DIR = 'record';
const CHALLENGE_COOKIE = 'pk_challenge';

// ─── record helpers ───────────────────────────────────────────────────────────

const recordPath = (username) => safeRecordPath(username);

const writeUserRecord = async (username, data) => {
    await fs.promises.writeFile(recordPath(username), JSON.stringify(data, null, 4), 'utf-8');
};

// Find which user owns a credential id (used for usernameless login).
const findUserByCredentialId = async (credentialId) => {
    const files = await fs.promises.readdir(RECORD_DIR);
    for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const username = file.replace(/\.json$/, '');
        const record = await getJson(recordPath(username));
        const passkey = (record.passkeys || []).find((p) => p.id === credentialId);
        if (passkey) return { username, record, passkey };
    }
    return null;
};

// ─── challenge cookie (stateless, signed, short-lived) ────────────────────────

const setChallengeCookie = (res, payload) => {
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '5m' });
    res.cookie(CHALLENGE_COOKIE, token, {
        httpOnly: true,
        secure: COOKIE_SECURE,
        sameSite: 'strict',
        maxAge: 5 * 60 * 1000,
    });
};

const readChallengeCookie = (req, expectedType) => {
    const token = req.cookies[CHALLENGE_COOKIE];
    if (!token) return null;
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.type !== expectedType) return null;
        return decoded;
    } catch {
        return null;
    }
};

const clearChallengeCookie = (res) => {
    res.clearCookie(CHALLENGE_COOKIE);
};

const issueAuthCookie = (res, payload) => {
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1d' });
    res.cookie('token', token, {
        httpOnly: true,
        secure: COOKIE_SECURE,
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000,
    });
};

// ─── Registration (requires an authenticated user) ────────────────────────────

// POST /api/passkey/register/options
export const getRegistrationOptions = async (req, res) => {
    try {
        const { user: username } = req.user;
        const record = await getJson(recordPath(username));
        const existing = record.passkeys || [];

        const options = await generateRegistrationOptions({
            rpName: WEBAUTHN_RP_NAME,
            rpID: WEBAUTHN_RP_ID,
            userName: username,
            userID: new TextEncoder().encode(username),
            attestationType: 'none',
            excludeCredentials: existing.map((p) => ({
                id: p.id,
                transports: p.transports,
            })),
            authenticatorSelection: {
                residentKey: 'preferred',
                userVerification: 'preferred',
            },
        });

        setChallengeCookie(res, { type: 'register', user: username, challenge: options.challenge });
        return res.json(options);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

// POST /api/passkey/register/verify
export const verifyRegistration = async (req, res) => {
    try {
        const { user: username } = req.user;
        const challengeData = readChallengeCookie(req, 'register');
        if (!challengeData || challengeData.user !== username) {
            return res.status(400).json({ success: false, error: 'Challenge expired, please retry' });
        }

        const { credential: response, label } = req.body;
        const verification = await verifyRegistrationResponse({
            response,
            expectedChallenge: challengeData.challenge,
            expectedOrigin: WEBAUTHN_ORIGINS,
            expectedRPID: WEBAUTHN_RP_ID,
        });

        clearChallengeCookie(res);

        if (!verification.verified || !verification.registrationInfo) {
            return res.status(400).json({ success: false, error: 'Registration could not be verified' });
        }

        const { credential } = verification.registrationInfo;
        const record = await getJson(recordPath(username));
        record.passkeys = record.passkeys || [];

        if (record.passkeys.some((p) => p.id === credential.id)) {
            return res.status(409).json({ success: false, error: 'This passkey is already registered' });
        }

        record.passkeys.push({
            id: credential.id,
            publicKey: Buffer.from(credential.publicKey).toString('base64url'),
            counter: credential.counter,
            transports: credential.transports || [],
            label: (label || 'Passkey').toString().slice(0, 60),
            createdAt: new Date().toISOString(),
        });
        await writeUserRecord(username, record);

        return res.json({ success: true, message: 'Passkey registered' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

// ─── Authentication (usernameless / discoverable login) ───────────────────────

// POST /api/passkey/login/options
export const getAuthenticationOptions = async (req, res) => {
    try {
        const options = await generateAuthenticationOptions({
            rpID: WEBAUTHN_RP_ID,
            userVerification: 'preferred',
            // No allowCredentials → the browser offers any discoverable passkey
            // for this site (usernameless login).
        });

        setChallengeCookie(res, { type: 'auth', challenge: options.challenge });
        return res.json(options);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

// POST /api/passkey/login/verify
export const verifyAuthentication = async (req, res) => {
    try {
        const challengeData = readChallengeCookie(req, 'auth');
        if (!challengeData) {
            return res.status(400).json({ success: false, error: 'Challenge expired, please retry' });
        }

        const { credential: response } = req.body;
        const found = await findUserByCredentialId(response.id);
        if (!found) {
            clearChallengeCookie(res);
            return res.status(401).json({ success: false, error: 'Unknown passkey' });
        }

        const { username, record, passkey } = found;
        const verification = await verifyAuthenticationResponse({
            response,
            expectedChallenge: challengeData.challenge,
            expectedOrigin: WEBAUTHN_ORIGINS,
            expectedRPID: WEBAUTHN_RP_ID,
            credential: {
                id: passkey.id,
                publicKey: new Uint8Array(Buffer.from(passkey.publicKey, 'base64url')),
                counter: passkey.counter,
                transports: passkey.transports,
            },
        });

        clearChallengeCookie(res);

        if (!verification.verified) {
            return res.status(401).json({ success: false, error: 'Passkey verification failed' });
        }

        // Persist the updated signature counter (replay protection).
        passkey.counter = verification.authenticationInfo.newCounter;
        await writeUserRecord(username, record);

        issueAuthCookie(res, { role: record.role, user: username });
        return res.json({ success: true, message: 'Login successful', user: username });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

// ─── Passkey management (authenticated) ───────────────────────────────────────

// GET /api/passkey/list
export const listPasskeys = async (req, res) => {
    try {
        const { user: username } = req.user;
        const record = await getJson(recordPath(username));
        const passkeys = (record.passkeys || []).map((p) => ({
            id: p.id,
            label: p.label || 'Passkey',
            createdAt: p.createdAt || null,
        }));
        return res.json({ success: true, data: passkeys });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

// DELETE /api/passkey/:id
export const deletePasskey = async (req, res) => {
    try {
        const { user: username } = req.user;
        const { id } = req.params;
        const record = await getJson(recordPath(username));
        const before = (record.passkeys || []).length;
        record.passkeys = (record.passkeys || []).filter((p) => p.id !== id);
        if (record.passkeys.length === before) {
            return res.status(404).json({ success: false, error: 'Passkey not found' });
        }
        await writeUserRecord(username, record);
        return res.json({ success: true, message: 'Passkey removed' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
};
