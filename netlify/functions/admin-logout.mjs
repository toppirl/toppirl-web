// Signs this browser out of /admin. Served at POST /api/admin/logout.
// To sign out everywhere, change ADMIN_PASSWORD in Netlify and redeploy.

import { CLEARED_SESSION_COOKIE, isSameOrigin, json, noContent } from '../lib/auth.mjs';

export default async (req) => {
    if (!isSameOrigin(req)) {
        return json({ error: 'Cross-origin request refused' }, 403);
    }
    return noContent({ 'Set-Cookie': CLEARED_SESSION_COOKIE });
};

export const config = {
    path: '/api/admin/logout',
    method: 'POST',
};
