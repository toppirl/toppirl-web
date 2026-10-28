// The gear list's rules, as netlify/lib/gear-store.mjs checks them on save, so the dashboard
// can point at a problem while it's being typed. The server still checks everything; keep
// the two in step, messages included.
export const LIMITS = {
    categories: 30,
    items: 300,
    categoryName: 40,
    name: 80,
    note: 140,
    store: 30,
    url: 2048,
    imageBytes: 512 * 1024,
};

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
// Lengths count code points, as on the server, so an emoji counts as 1
const characters = (text) => [...text].length;

// Each rule takes what was typed and returns { value } (trimmed or tidied, as it will be
// stored) or { error } (a sentence to show)
function text(label, max, required) {
    return (typed) => {
        const value = typed.trim();
        if (required && !value) return { error: `${label} can't be empty` };
        if (CONTROL.test(value)) return { error: `${label} can't contain line breaks or control characters` };
        if (characters(value) > max) return { error: `${label} is ${characters(value)} characters; the limit is ${max}` };
        return { value };
    };
}

// Stored as the browser writes the address back, so https://Example.com becomes https://example.com/
function link(typed) {
    let url = null;
    try {
        url = new URL(typed.trim());
    } catch {
        // Reported below
    }
    if (!url) return { error: 'Link must be a full web address, starting with https://' };
    if (url.protocol !== 'https:') return { error: 'Link must start with https://' };
    if (url.username || url.password) return { error: "Link can't include a username or password" };
    if (url.href.length > LIMITS.url) return { error: `Link is ${url.href.length} characters; the limit is ${LIMITS.url}` };
    return { value: url.href };
}

export const RULES = {
    categoryName: text('Category name', LIMITS.categoryName, true),
    name: text('Name', LIMITS.name, true),
    url: link,
    store: text('Store', LIMITS.store, false),
    note: text('Note', LIMITS.note, false),
};
