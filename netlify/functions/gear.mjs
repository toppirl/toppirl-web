// Serves the gear list for the gear page (js/gear.js) at /api/gear.
// Phase 1: hard-coded sample data. Phase 2 replaces it with the list saved in
// Netlify Blobs, in the same shape. Array order is display order. The hidden
// headset is a draft: the page skips it, and from Phase 2 this API leaves
// drafts out itself.

const SAMPLE = {
    categories: [
        { id: 'streaming', name: 'Streaming' },
        { id: 'desk', name: 'Desk' },
        { id: 'gaming', name: 'Gaming' },
    ],
    items: [
        {
            id: 'microphone',
            name: 'Microphone name',
            url: 'https://example.com/microphone',
            note: 'A short note about why I use it',
            store: 'Amazon',
            category: 'streaming',
            image: null,
            hidden: false,
        },
        {
            id: 'camera',
            name: 'Camera name',
            url: 'https://example.com/camera',
            note: 'A short note about why I use it',
            store: 'Amazon',
            category: 'streaming',
            image: null,
            hidden: false,
        },
        {
            id: 'keyboard',
            name: 'Keyboard name',
            url: 'https://example.com/keyboard',
            note: 'A short note about why I use it',
            store: 'Store name',
            category: 'desk',
            image: null,
            hidden: false,
        },
        {
            id: 'mouse',
            name: 'Mouse name',
            url: 'https://example.com/mouse',
            note: '',
            store: 'Amazon',
            category: 'desk',
            image: null,
            hidden: false,
        },
        {
            id: 'controller',
            name: 'Controller name',
            url: 'https://example.com/controller',
            note: 'A short note about why I use it',
            store: '',
            category: 'gaming',
            image: null,
            hidden: false,
        },
        {
            id: 'headset',
            name: 'Headset name (draft)',
            url: 'https://example.com/headset',
            note: 'Hidden, so the page skips it',
            store: 'Amazon',
            category: 'gaming',
            image: null,
            hidden: true,
        },
    ],
};

// Browsers always revalidate; Netlify's CDN shares one answer between visitors
// for `seconds`. Phase 2 purges that cache on save, so edits show straight away.
function json(body, status, seconds) {
    return Response.json(body, {
        status,
        headers: {
            'Cache-Control': 'public, max-age=0, must-revalidate',
            'Netlify-CDN-Cache-Control': `public, s-maxage=${seconds}, stale-while-revalidate=${seconds}`,
        },
    });
}

export default async () => json(SAMPLE, 200, 60);

export const config = {
    path: '/api/gear',
};
