// Serves the gear list for the gear page (js/gear.js) at GET /api/gear:
//     { categories: [{ id, name }], items: [{ id, name, url, note, store, category, image, hidden }] }
// The list lives in Netlify Blobs (lib/gear-store.mjs) and is edited from /admin. Array
// order is display order. Drafts never leave the server, so every item here is hidden: false.

import { json } from '../lib/auth.mjs';
import { gearStore, listCacheTag, publicGear, readGear } from '../lib/gear-store.mjs';

export default async (req, context) => {
    try {
        const { gear } = await readGear(gearStore(context));
        // Browsers always revalidate. Netlify's CDN keeps one copy for every visitor until
        // a save purges the tag, so the list is read from Blobs about once per save.
        return Response.json(publicGear(gear), {
            headers: {
                'Cache-Control': 'public, max-age=0, must-revalidate',
                'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=31536000',
                'Netlify-Cache-Tag': listCacheTag(context),
            },
        });
    } catch (err) {
        console.error(err);
        return json({ error: "Couldn't load the gear list right now" }, 503);
    }
};

export const config = {
    path: '/api/gear',
    method: 'GET',
};
