// Signs in to /admin. Served at POST /api/admin/login with a JSON body of { password },
// checked against ADMIN_PASSWORD (a Netlify environment variable). Sets the session
// cookie on success; too many wrong passwords lock sign-in for a while (see lib/auth.mjs).

import {
    adminPassword,
    clearSignInAttempts,
    createSessionCookie,
    isSameOrigin,
    json,
    noContent,
    passwordMatches,
    reserveSignInAttempt,
} from '../lib/auth.mjs';

export default async (req, context) => {
    if (!isSameOrigin(req)) {
        return json({ error: 'Cross-origin request refused' }, 403);
    }
    if (!adminPassword()) {
        return json({ error: "Sign-in isn't set up yet: ADMIN_PASSWORD isn't set in Netlify." }, 503);
    }

    let password;
    try {
        ({ password } = await req.json());
    } catch {
        // Not JSON, or JSON null: refused just below
    }
    if (typeof password !== 'string' || !password) {
        return json({ error: 'Send the password as JSON: { "password": "…" }' }, 400);
    }

    try {
        const retryAfter = await reserveSignInAttempt(context);
        if (retryAfter) {
            return json({ error: 'Too many sign-in attempts', retryAfter }, 429, {
                'Retry-After': String(retryAfter),
            });
        }
        if (!passwordMatches(password)) {
            return json({ error: "That password isn't right." }, 401);
        }

        await clearSignInAttempts(context);
        return noContent({ 'Set-Cookie': await createSessionCookie(context) });
    } catch (err) {
        console.error(err);
        return json({ error: 'Sign-in is unavailable right now. Try again in a minute.' }, 503);
    }
};

export const config = {
    path: '/api/admin/login',
    method: 'POST',
};
