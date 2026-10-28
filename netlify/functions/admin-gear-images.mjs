// Uploads a gear photo for the /admin dashboard. Signed in only (lib/auth.mjs).
//     POST /api/admin/gear/images   with the photo itself as the body
// JPEG, PNG or WebP, up to 512 KB; the dashboard resizes photos first. The type is read
// from the bytes, not the Content-Type, but that must still be an image type (or
// application/octet-stream): Netlify passes text-like bodies to functions as text, which
// mangles the bytes. Answers 201 { image, type, bytes }, where `image` is the photo's path
// for an item's `image`. A photo no saved list uses is deleted by the first save after an hour.

import { json, requireAdmin } from '../lib/auth.mjs';
import { LIMITS, gearStore, imageType, saveImage } from '../lib/gear-store.mjs';

const BINARY_TYPE = /^(image\/(jpeg|png|webp)|application\/octet-stream)\s*(;|$)/i;

const tooBig = () => json({ error: `Photos must be ${LIMITS.imageBytes / 1024} KB or smaller` }, 413);

export default async (req, context) => {
    const denied = await requireAdmin(req, context);
    if (denied) return denied;

    if (!BINARY_TYPE.test(req.headers.get('content-type') ?? '')) {
        return json({ error: 'Send the photo with Content-Type image/jpeg, image/png or image/webp' }, 415);
    }
    if (Number(req.headers.get('content-length')) > LIMITS.imageBytes) return tooBig();
    let data;
    try {
        data = await req.arrayBuffer();
    } catch {
        return json({ error: "Couldn't read the upload" }, 400);
    }
    if (data.byteLength > LIMITS.imageBytes) return tooBig();
    if (!data.byteLength) return json({ error: 'Send the photo as the request body' }, 400);

    const type = imageType(new Uint8Array(data));
    if (!type) return json({ error: 'Photos must be JPEG, PNG or WebP' }, 415);

    try {
        const image = await saveImage(gearStore(context), data, type);
        return json({ image, type, bytes: data.byteLength }, 201);
    } catch (err) {
        console.error(err);
        return json({ error: "Couldn't save the photo right now. Try again in a minute." }, 503);
    }
};

export const config = {
    path: '/api/admin/gear/images',
    method: 'POST',
};
