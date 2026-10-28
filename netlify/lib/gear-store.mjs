// The gear list and its photos, kept in Netlify Blobs. Shared by /api/gear (the gear
// page's list), /api/gear/img/:id (photos) and the /api/admin/gear functions that edit it.
//
// Store `gear` in production, `gear-preview` everywhere else (see storeName in auth.mjs):
//     gear.json   { revision, savedAt, categories: [{ id, name }],
//                   items: [{ id, name, url, note, store, category, image, hidden }] }
//     img/<id>    a photo's bytes, with metadata { type, uploadedAt }
// Array order is display order. `revision` counts saves: a save names the revision its
// edits started from, so two tabs can't silently overwrite each other.

import { getStore } from '@netlify/blobs';
import { purgeCache } from '@netlify/functions';
import { randomBytes } from 'node:crypto';
import { storeName } from './auth.mjs';

const GEAR_KEY = 'gear.json';
const IMAGE_PREFIX = 'img/';
const IMAGE_PATH = '/api/gear/img/';

export const LIMITS = {
    categories: 30,
    items: 300,
    categoryName: 40,
    name: 80,
    note: 140,
    store: 30,
    url: 2048,
    imageBytes: 512 * 1024,
    requestBytes: 2 * 1024 * 1024,
};

// A photo uploaded but not yet in a saved list is kept this long, so a save landing between
// the dashboard's upload and its own save can't delete it
const UNSAVED_IMAGE_MS = 60 * 60_000;

const EMPTY = { revision: 0, savedAt: null, categories: [], items: [] };
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const IMAGE_ID = /^[0-9a-f]{32}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

const imageKey = (id) => `${IMAGE_PREFIX}${id}`;
const imagePath = (id) => `${IMAGE_PATH}${id}`;

export function gearStore(context) {
    return getStore({ name: storeName('gear', context), consistency: 'strong' });
}

// True when this deploy edits the preview copy of the list rather than the live site's
export const isPreview = (context) => storeName('gear', context) !== 'gear';

// The public list sits in Netlify's CDN under this tag until a save purges it. Previews
// get their own tag, since a tag purge reaches every deploy of the site.
export const listCacheTag = (context) => storeName('gear', context);
export const imageCacheTag = (id) => `gear-img-${id}`;

// Resolves to { gear, unchanged }. An empty store is an empty list at revision 0.
// `unchanged` is the write condition (compare-and-swap on the blob's ETag) that makes a
// write fail if the list changed since this read. The local `netlify dev` sandbox sends
// no ETags on reads, so there writes can't be conditional.
export async function readGear(store) {
    const entry = await store.getWithMetadata(GEAR_KEY, { type: 'json' });
    if (!entry) return { gear: EMPTY, unchanged: { onlyIfNew: true } };
    return { gear: entry.data, unchanged: entry.etag ? { onlyIfMatch: entry.etag } : {} };
}

// What the gear page gets: drafts never leave the server, and nor do categories that
// only hold drafts
export function publicGear({ categories, items }) {
    const visible = items.filter((item) => !item.hidden);
    const used = new Set(visible.map((item) => item.category));
    return { categories: categories.filter((category) => used.has(category.id)), items: visible };
}

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const characters = (text) => [...text].length;

// Checks a list sent by the dashboard against the store's photos. Returns { gear } with
// text trimmed and links normalised, or { problems: [{ path, message }] } where path
// names the field, like "items[3].url".
export function validateGear(input, imageIds) {
    const problems = [];
    const problem = (path, message) => problems.push({ path, message });

    if (!isObject(input)) {
        return { problems: [{ path: '', message: 'Send the gear list as a JSON object: { revision, categories, items }' }] };
    }
    if (!Number.isSafeInteger(input.revision) || input.revision < 0) {
        problem('revision', 'Send the revision your edits started from, as GET /api/admin/gear gave it');
    }
    for (const field of ['categories', 'items']) {
        if (!Array.isArray(input[field])) problem(field, `${capitalised(field)} must be a list`);
        else if (input[field].length > LIMITS[field]) {
            problem(field, `There are ${input[field].length} ${field}; the limit is ${LIMITS[field]}`);
        }
    }
    if (problems.length) return { problems };
    // savedAt and preview are allowed (and ignored) so the dashboard can send back what GET gave it
    unknownFields(input, ['revision', 'savedAt', 'preview', 'categories', 'items'], '', problem);

    const categoryIds = new Set();
    const categories = input.categories.map((category, i) => {
        const path = `categories[${i}]`;
        if (!isObject(category)) {
            problem(path, 'Each category must be an object: { id, name }');
            return null;
        }
        unknownFields(category, ['id', 'name'], path, problem);
        return {
            id: checkId(category.id, `${path}.id`, categoryIds, 'Category', problem),
            name: checkText(category.name, `${path}.name`, 'Category name', LIMITS.categoryName, true, problem),
        };
    });

    const itemIds = new Set();
    const items = input.items.map((item, i) => {
        const path = `items[${i}]`;
        if (!isObject(item)) {
            problem(path, 'Each item must be an object: { id, name, url, category, … }');
            return null;
        }
        unknownFields(item, ['id', 'name', 'url', 'note', 'store', 'category', 'image', 'hidden'], path, problem);
        if (typeof item.category !== 'string' || !categoryIds.has(item.category)) {
            problem(`${path}.category`, "Category must be the id of one of the list's categories");
        }
        if (item.hidden !== undefined && typeof item.hidden !== 'boolean') {
            problem(`${path}.hidden`, 'Hidden must be true or false');
        }
        return {
            id: checkId(item.id, `${path}.id`, itemIds, 'Item', problem),
            name: checkText(item.name, `${path}.name`, 'Name', LIMITS.name, true, problem),
            url: checkUrl(item.url, `${path}.url`, problem),
            note: checkText(item.note, `${path}.note`, 'Note', LIMITS.note, false, problem),
            store: checkText(item.store, `${path}.store`, 'Store', LIMITS.store, false, problem),
            category: item.category,
            image: checkImage(item.image, `${path}.image`, imageIds, problem),
            hidden: item.hidden === true,
        };
    });

    return problems.length ? { problems: problems.slice(0, 50) } : { gear: { categories, items } };
}

const capitalised = (word) => word[0].toUpperCase() + word.slice(1);

function unknownFields(value, allowed, path, problem) {
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) problem(path ? `${path}.${key}` : key, `"${key}" isn't a field the gear list has`);
    }
}

function checkId(value, path, seen, label, problem) {
    if (typeof value !== 'string' || !ID.test(value)) {
        problem(path, `${label} id must be 1–64 letters, digits, - or _`);
    } else if (seen.has(value)) {
        problem(path, `${label} id "${value}" is used more than once`);
    }
    seen.add(value);
    return value;
}

// Optional text may be left out, and is then ''
function checkText(value, path, label, max, required, problem) {
    if (value === undefined && !required) return '';
    if (typeof value !== 'string') {
        problem(path, `${label} must be text`);
        return '';
    }
    const text = value.trim();
    if (required && !text) problem(path, `${label} can't be empty`);
    else if (CONTROL.test(text)) problem(path, `${label} can't contain line breaks or control characters`);
    else if (characters(text) > max) problem(path, `${label} is ${characters(text)} characters; the limit is ${max}`);
    return text;
}

function checkUrl(value, path, problem) {
    let url = null;
    try {
        url = new URL(typeof value === 'string' ? value.trim() : '');
    } catch {
        // Reported below
    }
    if (!url) problem(path, 'Link must be a full web address, starting with https://');
    else if (url.protocol !== 'https:') problem(path, 'Link must start with https://');
    else if (url.username || url.password) problem(path, "Link can't include a username or password");
    else if (url.href.length > LIMITS.url) problem(path, `Link is ${url.href.length} characters; the limit is ${LIMITS.url}`);
    return url?.href ?? '';
}

function checkImage(value, path, imageIds, problem) {
    if (value === undefined || value === null) return null;
    const id = typeof value === 'string' && value.startsWith(IMAGE_PATH) ? value.slice(IMAGE_PATH.length) : '';
    if (!IMAGE_ID.test(id)) {
        problem(path, `Photo must be null or a path the photo upload gave (${IMAGE_PATH}…)`);
    } else if (!imageIds.has(id)) {
        problem(path, 'That photo was deleted once nothing used it, or never uploaded. Upload it again.');
    }
    return value;
}

async function listImageIds(store) {
    const { blobs } = await store.list({ prefix: IMAGE_PREFIX });
    return new Set(blobs.map(({ key }) => key.slice(IMAGE_PREFIX.length)));
}

const imagesIn = (gear) => new Set(gear.items.filter((item) => item.image).map((item) => item.image.slice(IMAGE_PATH.length)));

// Saves a whole list sent by the dashboard. Resolves to one of:
//     { saved, deletedImages }   saved is the list as stored; deletedImages are photo ids
//     { problems }               the list isn't valid (see validateGear); nothing saved
//     { conflict }               someone saved since input.revision; conflict is their list
export async function saveGear(store, input) {
    const imageIds = await listImageIds(store);
    const { gear, problems } = validateGear(input, imageIds);
    if (problems) return { problems };

    const { gear: current, unchanged } = await readGear(store);
    if (input.revision !== current.revision) return { conflict: current };

    // Conditional, so a save racing this one can't be lost
    const saved = { revision: current.revision + 1, savedAt: new Date().toISOString(), ...gear };
    const write = await store.setJSON(GEAR_KEY, saved, unchanged);
    if (!write.modified) return { conflict: (await readGear(store)).gear };
    // @netlify/blobs 11.1.6 reports a conditional write that failed with a 5xx as modified,
    // with no ETag, so check the list really is this one before going on
    if (!write.etag && JSON.stringify((await readGear(store)).gear) !== JSON.stringify(saved)) {
        throw new Error("The gear list wasn't saved to Netlify Blobs");
    }

    let deletedImages = [];
    try {
        deletedImages = await deleteUnusedImages(store, imageIds, current, saved);
    } catch (err) {
        // The list is saved; leftover photos go at a later save
        console.error(err);
    }
    return { saved, deletedImages };
}

// Deletes photos nothing uses any more: straight away if the list used to show them, and
// after UNSAVED_IMAGE_MS if they were uploaded but never saved into the list
async function deleteUnusedImages(store, imageIds, previous, saved) {
    const inUse = imagesIn(saved);
    const unused = [...imageIds].filter((id) => !inUse.has(id));
    if (!unused.length) return [];

    // A save that landed after this one may use some of them again
    const latest = imagesIn((await readGear(store)).gear);
    const wasInUse = imagesIn(previous);
    const deleted = [];
    for (const id of unused) {
        if (latest.has(id)) continue;
        if (!wasInUse.has(id)) {
            const uploadedAt = Number((await store.getMetadata(imageKey(id)))?.metadata?.uploadedAt);
            if (Date.now() - uploadedAt < UNSAVED_IMAGE_MS) continue;
        }
        await store.delete(imageKey(id));
        deleted.push(id);
    }
    return deleted;
}

// Purges the public list, and any deleted photos, from Netlify's CDN. Resolves to false if
// that failed twice; the second try waits out the purge rate limit (twice per tag every 5s).
export async function purgeGearCache(context, deletedImages = []) {
    const tags = [listCacheTag(context), ...deletedImages.map(imageCacheTag)];
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            await purgeCache({ tags });
            return true;
        } catch (err) {
            console.error(err);
            if (attempt === 1) await new Promise((resolve) => setTimeout(resolve, 3000));
        }
    }
    return false;
}

// JPEG, PNG or WebP, told apart by the file's first bytes rather than what the client says
export function imageType(bytes) {
    const has = (signature, at = 0) => [...signature].every((char, i) => bytes[at + i] === char.charCodeAt(0));
    if (has('\xff\xd8\xff')) return 'image/jpeg';
    if (has('\x89PNG\r\n\x1a\n')) return 'image/png';
    if (has('RIFF') && has('WEBP', 8)) return 'image/webp';
    return null;
}

// Stores an upload that imageType has checked. Resolves to its path, for an item's `image`.
export async function saveImage(store, data, type) {
    const id = randomBytes(16).toString('hex');
    await store.set(imageKey(id), data, { metadata: { type, uploadedAt: Date.now() } });
    return imagePath(id);
}

// Resolves to the photo's bytes as an ArrayBuffer, or null if there's no such photo
export async function readImage(store, id) {
    return IMAGE_ID.test(id ?? '') ? store.get(imageKey(id), { type: 'arrayBuffer' }) : null;
}
