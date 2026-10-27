// Tells /admin whether this browser is signed in. Served at GET /api/admin/session
// as { signedIn: true | false }.

import { hasValidSession, json } from '../lib/auth.mjs';

export default async (req, context) => {
    try {
        return json({ signedIn: await hasValidSession(req, context) });
    } catch (err) {
        console.error(err);
        return json({ error: 'Sign-in is unavailable right now. Try again in a minute.' }, 503);
    }
};

export const config = {
    path: '/api/admin/session',
    method: 'GET',
};
