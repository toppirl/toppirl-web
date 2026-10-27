// The whole gear list, drafts included, for the /admin dashboard. Signed in only (lib/auth.mjs).
//     GET /api/admin/gear   { revision, savedAt, preview, categories, items }
//     PUT /api/admin/gear   with { revision, categories, items }: replaces the whole list
// `revision` is the one the edits started from. If someone saved since, the PUT gets 409
// with their list as `current`. A save purges the public list from the CDN and deletes
// photos nothing uses any more. `preview` is true on deploy previews and `netlify dev`,
// which edit a separate copy of the list (see storeName in lib/auth.mjs).

import { json, requireAdmin } from '../lib/auth.mjs';
import { LIMITS, gearStore, isPreview, purgeGearCache, readGear, saveGear } from '../lib/gear-store.mjs';

const tooBig = () => json({ error: `The gear list is over ${LIMITS.requestBytes / 1024 / 1024} MB` }, 413);

export default async (req, context) => {
    const denied = await requireAdmin(req, context);
    if (denied) return denied;

    const store = gearStore(context);
    const preview = isPreview(context);

    if (req.method === 'GET') {
        try {
            const { gear } = await readGear(store);
            return json({ ...gear, preview });
        } catch (err) {
            console.error(err);
            return json({ error: "Couldn't load the gear list right now. Try again in a minute." }, 503);
        }
    }

    if (Number(req.headers.get('content-length')) > LIMITS.requestBytes) return tooBig();
    let body;
    try {
        body = await req.text();
    } catch {
        return json({ error: "Couldn't read the request" }, 400);
    }
    if (Buffer.byteLength(body) > LIMITS.requestBytes) return tooBig();
    let input;
    try {
        input = JSON.parse(body);
    } catch {
        return json({ error: 'Send the gear list as JSON: { revision, categories, items }' }, 400);
    }

    let result;
    try {
        result = await saveGear(store, input);
    } catch (err) {
        console.error(err);
        return json({ error: "Couldn't save the gear list right now. Try again in a minute." }, 503);
    }

    if (result.problems) {
        const count = result.problems.length;
        return json({ error: `Not saved: ${count} problem${count === 1 ? '' : 's'} to fix`, problems: result.problems }, 400);
    }
    if (result.conflict) {
        return json({
            error: 'Not saved: the gear list changed since you loaded it, maybe in another tab',
            current: { ...result.conflict, preview },
        }, 409);
    }
    const cachePurged = await purgeGearCache(context, result.deletedImages);
    return json({ ...result.saved, preview, cachePurged });
};

export const config = {
    path: '/api/admin/gear',
    method: ['GET', 'PUT'],
};
