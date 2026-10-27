// Admin sign-in, shared by the /api/admin/* functions and any function that edits the site.
// ADMIN_PASSWORD (a Netlify environment variable) is the only secret to manage: the
// signing key is generated into Netlify Blobs, and a session is a signed cookie.
//
// Guard a function with:
//     const denied = await requireAdmin(req, context);
//     if (denied) return denied;

import { getStore } from '@netlify/blobs';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = '__Host-toppirl_admin';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const COOKIE_FLAGS = 'Path=/; Secure; HttpOnly; SameSite=Strict';

export const CLEARED_SESSION_COOKIE = `${SESSION_COOKIE}=; Max-Age=0; ${COOKIE_FLAGS}`;

const sha256 = (value) => createHash('sha256').update(value).digest();

// The admin store and its keys. Attempt counts are { attempts: [ms timestamps] }.
const ADMIN_STORE = 'admin';
const SIGNING_KEY = 'signing-key';
const SITE_ATTEMPTS_KEY = 'attempts/site';
const ipAttemptsKey = (ip) => `attempts/ip/${sha256(addressBucket(ip)).toString('hex').slice(0, 32)}`;

// Sign-in attempts allowed per address, and across the whole site so guesses spread
// over many addresses still run out. A correct password clears its address's count.
const IP_LIMIT = { max: 5, windowMs: 15 * 60_000 };
const SITE_LIMIT = { max: 50, windowMs: 60 * 60_000 };

export function json(body, status = 200, headers = {}) {
    return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

export function noContent(headers = {}) {
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store', ...headers } });
}

// Deploy previews, branch deploys and `netlify dev` get their own stores, so testing
// never touches the live site's data. Any context that isn't production counts as a preview.
export function storeName(name, context) {
    return context?.deploy?.context === 'production' ? name : `${name}-preview`;
}

function adminStore(context) {
    return getStore({ name: storeName(ADMIN_STORE, context), consistency: 'strong' });
}

export const adminPassword = () => Netlify.env.get('ADMIN_PASSWORD') || null;

// Hashing both sides first gives timingSafeEqual equal lengths whatever was typed
export function passwordMatches(candidate) {
    const expected = adminPassword();
    return Boolean(expected) && timingSafeEqual(sha256(candidate), sha256(expected));
}

// Browsers send Origin on every POST, so a missing or foreign one is a cross-site request
export function isSameOrigin(req) {
    return req.headers.get('origin') === new URL(req.url).origin;
}

function decodeKey(saved) {
    const key = Buffer.from(saved ?? '', 'base64');
    if (key.length !== 32) {
        throw new Error('The admin signing key in Netlify Blobs is missing or malformed');
    }
    return key;
}

// 32 random bytes made on first use. onlyIfNew settles the race when two cold
// functions both find no key, and reading back means both use whichever was saved.
async function loadSigningKey(store) {
    const saved = await store.get(SIGNING_KEY);
    if (saved !== null) return decodeKey(saved);

    await store.set(SIGNING_KEY, randomBytes(32).toString('base64'), { onlyIfNew: true });
    return decodeKey(await store.get(SIGNING_KEY));
}

// Kept while the function stays warm; a failed load isn't kept, so the next request retries
const signingKeys = new Map();

function signingKey(context) {
    const name = storeName(ADMIN_STORE, context);
    if (!signingKeys.has(name)) {
        const pending = loadSigningKey(adminStore(context));
        pending.catch(() => signingKeys.delete(name));
        signingKeys.set(name, pending);
    }
    return signingKeys.get(name);
}

// The password's hash is part of what's signed, so changing ADMIN_PASSWORD signs everyone out
function sign(key, expires, password) {
    return createHmac('sha256', key)
        .update(`${expires}.${sha256(password).toString('hex')}`)
        .digest('base64url');
}

// Only call once the password has checked out
export async function createSessionCookie(context) {
    const expires = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
    const value = `${expires}.${sign(await signingKey(context), expires, adminPassword())}`;
    return `${SESSION_COOKIE}=${value}; Max-Age=${SESSION_SECONDS}; ${COOKIE_FLAGS}`;
}

function readCookie(req, name) {
    for (const pair of (req.headers.get('cookie') ?? '').split(';')) {
        const [key, ...value] = pair.trim().split('=');
        if (key === name) return value.join('=');
    }
    return null;
}

// Value is "<expiry in unix seconds>.<base64url HMAC-SHA256>". Throws if Blobs is unreachable.
export async function hasValidSession(req, context) {
    const password = adminPassword();
    const match = /^(\d{1,12})\.([\w-]{43})$/.exec(readCookie(req, SESSION_COOKIE) ?? '');
    if (!password || !match || Number(match[1]) * 1000 <= Date.now()) return false;

    const [, expires, signature] = match;
    const expected = Buffer.from(sign(await signingKey(context), expires, password));
    return timingSafeEqual(expected, Buffer.from(signature));
}

// Resolves to null when the request may go ahead, otherwise to the Response to send:
// 403 for a write (anything but GET or HEAD) from another origin, 401 when not signed in,
// 503 when Blobs can't be reached.
export async function requireAdmin(req, context) {
    if (!['GET', 'HEAD'].includes(req.method) && !isSameOrigin(req)) {
        return json({ error: 'Cross-origin request refused' }, 403);
    }
    try {
        if (await hasValidSession(req, context)) return null;
    } catch (err) {
        console.error(err);
        return json({ error: 'Sign-in is unavailable right now' }, 503);
    }
    return json({ error: 'Not signed in' }, 401);
}

// Many IPv6 users hold a whole /64, so count those per /64 rather than per address
function addressBucket(ip) {
    const address = (ip ?? '').replace(/^::ffff:(?=\d+\.)/i, '').split('%')[0];
    if (!address.includes(':')) return address || 'unknown';

    const [head, tail] = address.split('::');
    const left = head ? head.split(':') : [];
    const right = tail ? tail.split(':') : [];
    const groups = tail === undefined
        ? left
        : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
    return `${groups.slice(0, 4).map((group) => group.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

// Counts one attempt in a sliding window, or refuses when the window is full. Writes are
// compare-and-swap on the blob's ETag, so a burst of parallel requests can't all read
// "not locked" before any of them is counted. Resolves to 0 when counted, otherwise
// to the seconds until the window has room.
async function reserveAttempt(store, key, { max, windowMs }) {
    for (let tries = 0; tries < 5; tries++) {
        const now = Date.now();
        const entry = await store.getWithMetadata(key, { type: 'json' });
        const saved = Array.isArray(entry?.data?.attempts) ? entry.data.attempts : [];
        const recent = saved.filter((at) => at > now - windowMs).sort((a, b) => a - b);
        if (recent.length >= max) {
            return Math.max(1, Math.ceil((recent[recent.length - max] + windowMs - now) / 1000));
        }

        const condition = entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true };
        const { modified } = await store.setJSON(key, { attempts: [...recent, now] }, condition);
        if (modified) return 0;
    }
    // Lost every race: sign-in is being hammered, so this caller waits too
    return 60;
}

// Call before checking the password. Resolves to 0 if the attempt may go ahead,
// otherwise to the seconds to wait (for the Retry-After header).
export async function reserveSignInAttempt(context) {
    const store = adminStore(context);
    return (await reserveAttempt(store, ipAttemptsKey(context.ip), IP_LIMIT))
        || reserveAttempt(store, SITE_ATTEMPTS_KEY, SITE_LIMIT);
}

// After a correct password. Best effort: a leftover count only expires on its own.
export async function clearSignInAttempts(context) {
    try {
        await adminStore(context).delete(ipAttemptsKey(context.ip));
    } catch (err) {
        console.error(err);
    }
}
