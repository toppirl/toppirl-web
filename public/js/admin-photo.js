// Gets a picked photo ready to upload. It must be JPEG, PNG or WebP, which the server tells
// apart by the file's first bytes, so this checks them the same way. It's cropped to a
// centred square (the shape /gear shows), scaled to at most 512px and saved as WebP, or as
// JPEG where the browser can't make WebP (Safari), to well under the 512 KB limit.
import { LIMITS } from './admin-rules.js';

const SIDE = 512;
const QUALITIES = [0.82, 0.7, 0.55];
// Bigger files are refused before decoding, which could run a phone out of memory
const MAX_FILE_MB = 25;

async function isAllowedType(file) {
    const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const has = (signature, at = 0) => [...signature].every((char, i) => bytes[at + i] === char.charCodeAt(0));
    return has('\xff\xd8\xff') || has('\x89PNG\r\n\x1a\n') || (has('RIFF') && has('WEBP', 8));
}

function draw(source, x, y, from, size) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, x, y, from, from, 0, 0, size, size);
    return canvas;
}

// The centred square, scaled down by at most half a step at a time: one big jump can look
// jagged in some browsers. The first step also keeps huge photos off a huge canvas.
function square(bitmap) {
    const crop = Math.min(bitmap.width, bitmap.height);
    const target = Math.min(SIDE, crop);
    let size = target;
    while (size * 2 < crop) size *= 2;
    let canvas = draw(bitmap, (bitmap.width - crop) / 2, (bitmap.height - crop) / 2, crop, size);
    while (size > target) {
        size /= 2;
        canvas = draw(canvas, 0, 0, canvas.width, size);
    }
    return canvas;
}

// JPEG has no transparency, so a see-through photo gets the card color behind it
function flatten(canvas) {
    const flat = document.createElement('canvas');
    flat.width = canvas.width;
    flat.height = canvas.height;
    const context = flat.getContext('2d');
    context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#1e293b';
    context.fillRect(0, 0, flat.width, flat.height);
    context.drawImage(canvas, 0, 0);
    return flat;
}

// Browsers that can't encode WebP hand back a PNG instead
function canEncodeWebp() {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    return canvas.toDataURL('image/webp').startsWith('data:image/webp');
}

const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

// Resolves to { photo, preview }: the Blob to upload, and a canvas showing it, since the
// CSP blocks blob: images. Throws an Error with a sentence to show if the photo won't do.
export async function preparePhoto(file) {
    if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`That photo is over ${MAX_FILE_MB} MB. Pick a smaller one.`);
    if (!(await isAllowedType(file))) throw new Error('Photos must be JPEG, PNG or WebP');

    let bitmap;
    try {
        // Turned the way the camera meant; older browsers don't know the option
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
    } catch {
        throw new Error("Couldn't read that photo. Try another one.");
    }
    const scaled = square(bitmap);
    bitmap.close();

    const type = canEncodeWebp() ? 'image/webp' : 'image/jpeg';
    const preview = type === 'image/jpeg' ? flatten(scaled) : scaled;
    for (const quality of QUALITIES) {
        const photo = await toBlob(preview, type, quality);
        if (photo && photo.size <= LIMITS.imageBytes) return { photo, preview };
    }
    throw new Error(`That photo is still over ${LIMITS.imageBytes / 1024} KB after shrinking. Try another one.`);
}
