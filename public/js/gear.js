// Draws the gear page from /api/gear (see netlify/functions/gear.mjs):
//   { categories: [{ id, name }], items: [{ id, name, url, note, store, category, image, hidden }] }
// One group per category, in array order. Everything is built with createElement
// and textContent, never innerHTML, so nothing typed into the list can add markup.
const SLOW_AFTER_MS = 500;
const SVG_NS = 'http://www.w3.org/2000/svg';
const ARROW = ['m9 18 6-6-6-6'];
// A parcel, for gear without a photo
const PARCEL = ['M21 8 12 3 3 8v8l9 5 9-5z', 'm3 8 9 5 9-5', 'M12 13v8', 'm7.5 5.5 9 5'];

const root = document.querySelector('[data-gear]');

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

function lineIcon(paths, className) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', className ? `${className} icon-line` : 'icon-line');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    for (const d of paths) {
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', d);
        svg.append(path);
    }
    return svg;
}

function iconTile() {
    const tile = el('span', 'link-thumb');
    tile.append(lineIcon(PARCEL));
    return tile;
}

// Gear links must be https
function httpsUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' ? url.href : null;
    } catch {
        return null;
    }
}

// Photos must come from this site (the CSP blocks anything else anyway)
function sameOriginImage(value) {
    if (typeof value !== 'string' || !value) return null;
    try {
        const url = new URL(value, location.origin);
        return url.origin === location.origin ? url.href : null;
    } catch {
        return null;
    }
}

function gearCard(item) {
    const link = el('a', 'link-card');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'sponsored noopener noreferrer';

    const image = sameOriginImage(item.image);
    if (image) {
        const img = el('img', 'link-thumb');
        img.alt = '';
        img.width = 56;
        img.height = 56;
        img.loading = 'lazy';
        img.decoding = 'async';
        // A missing photo falls back to the icon tile instead of a broken image
        img.addEventListener('error', () => img.replaceWith(iconTile()), { once: true });
        img.src = image;
        link.append(img);
    } else {
        link.append(iconTile());
    }

    const text = el('span', 'link-text');
    text.append(el('span', 'link-title', item.name));
    if (item.store || item.note) {
        const meta = el('span', 'link-subtitle gear-meta');
        if (item.store) meta.append(el('span', 'gear-store', String(item.store)));
        if (item.note) meta.append(el('span', null, String(item.note)));
        text.append(meta);
    }
    link.append(text, lineIcon(ARROW, 'link-arrow'));

    const li = el('li');
    li.append(link);
    return li;
}

function gearGroup(group) {
    const section = el('section', 'gear-group');
    const list = el('ul', 'links');
    list.append(...group.items.map(gearCard));
    section.append(el('h2', 'gear-heading', group.name), list);
    return section;
}

function showStatus(title, detail) {
    const status = el('div', 'gear-status');
    status.append(el('p', 'gear-status-title', title));
    if (detail) status.append(el('p', 'link-subtitle', detail));
    root.replaceChildren(status);
}

function render(data) {
    if (!data || !Array.isArray(data.items)) throw new Error('Unexpected gear list');
    const categories = Array.isArray(data.categories) ? data.categories : [];

    const groups = categories.map((category) => ({ name: String(category?.name || 'Other'), items: [] }));
    const byId = new Map(categories.map((category, i) => [category?.id, groups[i]]));
    // Items whose category has gone missing still show, at the end
    const other = { name: 'Other', items: [] };
    groups.push(other);

    for (const item of data.items) {
        // Drafts stay off the page, as do items without a name or an https link
        if (!item || item.hidden || typeof item.name !== 'string' || !item.name) continue;
        const url = httpsUrl(item.url);
        if (!url) continue;
        (byId.get(item.category) ?? other).items.push({ ...item, url });
    }

    const shown = groups.filter((group) => group.items.length);
    if (!shown.length) {
        showStatus('Nothing here yet', "I'm still putting this list together. Check back soon.");
        return;
    }
    root.replaceChildren(...shown.map(gearGroup));
}

async function load() {
    // Only say it's loading when the answer is slow, so a fast one doesn't flash
    const slow = setTimeout(() => showStatus('Loading my gear…'), SLOW_AFTER_MS);
    let data = null;
    try {
        const res = await fetch('/api/gear');
        if (res.ok) data = await res.json();
    } catch {
        // Network hiccup or bad JSON: handled below like any other failed load
    }
    clearTimeout(slow);

    try {
        if (!data) throw new Error('No gear list');
        render(data);
    } catch {
        showStatus("Couldn't load my gear", 'Something went wrong on my end. Refresh the page to try again.');
    }
}

if (root) load();
