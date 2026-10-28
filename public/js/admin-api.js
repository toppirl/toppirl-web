// The dashboard's calls to the admin API (netlify/functions/admin-gear*.mjs). Each resolves
// to { status, data }, where data is the JSON answer. A failed call always has data.error,
// a sentence to show; status 0 means the server couldn't be reached.
async function call(url, options = {}) {
    let res;
    try {
        res = await fetch(url, { cache: 'no-store', ...options });
    } catch {
        return { status: 0, data: { error: "Couldn't reach the server. Check your connection and try again." } };
    }
    let data = {};
    try {
        data = (await res.json()) ?? {};
    } catch {
        // No JSON body: the status code says enough
    }
    if (!res.ok && typeof data.error !== 'string') {
        data = { ...data, error: `Something went wrong (error ${res.status}). Try again.` };
    }
    return { status: res.status, data };
}

export const loadGear = () => call('/api/admin/gear');

// `list` is { revision, categories, items }, where revision is the one the edits started from
export const saveGear = (list) => call('/api/admin/gear', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(list),
});

// The body is the photo itself. It needs an image Content-Type, or Netlify passes the
// bytes to the function as text and mangles them.
export const uploadPhoto = (photo) => call('/api/admin/gear/images', {
    method: 'POST',
    headers: { 'Content-Type': photo.type || 'application/octet-stream' },
    body: photo,
});
