// Reports whether TWITCH_LOGIN is streaming, for the "Live now" card.
// Served at /api/twitch-live. Needs TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET
// (from a Twitch app at dev.twitch.tv) set as Netlify environment variables.

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const STREAMS_URL = 'https://api.twitch.tv/helix/streams';

// App access tokens last about two months, so reuse one while the function stays warm.
let cachedToken = null;

async function getAppToken(clientId, clientSecret) {
    if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
        return cachedToken.value;
    }

    const res = await fetch(TOKEN_URL, {
        method: 'POST',
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'client_credentials',
        }),
    });
    if (!res.ok) {
        throw new Error(`Twitch token request failed: ${res.status}`);
    }

    const { access_token, expires_in } = await res.json();
    cachedToken = { value: access_token, expiresAt: Date.now() + expires_in * 1000 };
    return cachedToken.value;
}

async function fetchStream(login, clientId, clientSecret) {
    for (let attempt = 0; attempt < 2; attempt++) {
        const token = await getAppToken(clientId, clientSecret);
        const res = await fetch(`${STREAMS_URL}?user_login=${encodeURIComponent(login)}`, {
            headers: { 'Client-Id': clientId, Authorization: `Bearer ${token}` },
        });

        // A revoked token: drop it and retry once with a fresh one
        if (res.status === 401 && attempt === 0) {
            cachedToken = null;
            continue;
        }
        if (!res.ok) {
            throw new Error(`Twitch streams request failed: ${res.status}`);
        }

        const { data } = await res.json();
        return data[0] ?? null;
    }
}

// Browsers always revalidate; Netlify's CDN shares one answer between visitors
// for `seconds`, so Twitch sees about one request a minute however busy the page is.
function json(body, status, seconds) {
    return Response.json(body, {
        status,
        headers: {
            'Cache-Control': 'public, max-age=0, must-revalidate',
            'Netlify-CDN-Cache-Control': `public, s-maxage=${seconds}, stale-while-revalidate=${seconds}`,
        },
    });
}

export default async () => {
    const clientId = Netlify.env.get('TWITCH_CLIENT_ID');
    const clientSecret = Netlify.env.get('TWITCH_CLIENT_SECRET');
    const login = Netlify.env.get('TWITCH_LOGIN') || 'toppirl';

    if (!clientId || !clientSecret) {
        return json({ live: false, error: 'Twitch credentials are not configured' }, 500, 300);
    }

    try {
        const stream = await fetchStream(login, clientId, clientSecret);
        if (!stream) {
            return json({ live: false }, 200, 60);
        }
        return json({
            live: true,
            title: stream.title,
            game: stream.game_name,
            viewers: stream.viewer_count,
            startedAt: stream.started_at,
        }, 200, 60);
    } catch (err) {
        console.error(err);
        return json({ live: false, error: 'Could not reach Twitch' }, 502, 30);
    }
};

export const config = {
    path: '/api/twitch-live',
};
