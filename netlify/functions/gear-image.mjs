// Serves gear photos at GET /api/gear/img/<id>, the paths the photo upload hands out.
// Ids are random and a photo never changes once uploaded, so browsers and Netlify's CDN
// keep it for a year. A save that deletes a photo purges its tag from the CDN.

import { json } from '../lib/auth.mjs';
import { gearStore, imageCacheTag, imageType, readImage } from '../lib/gear-store.mjs';

export default async (req, context) => {
    const { id } = context.params;
    try {
        const data = await readImage(gearStore(context), id);
        // Checked again on the way out, so only an image type can ever be sent
        const type = data && imageType(new Uint8Array(data));
        if (!type) return json({ error: 'No such photo' }, 404);

        return new Response(data, {
            headers: {
                'Content-Type': type,
                'X-Content-Type-Options': 'nosniff',
                // Shown on this site only; other sites can't hotlink it
                'Cross-Origin-Resource-Policy': 'same-origin',
                'Cache-Control': 'public, max-age=31536000, immutable',
                'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=31536000, immutable',
                'Netlify-Cache-Tag': imageCacheTag(id),
            },
        });
    } catch (err) {
        console.error(err);
        return json({ error: "Couldn't load the photo right now" }, 503);
    }
};

export const config = {
    path: '/api/gear/img/:id',
    method: 'GET',
};
