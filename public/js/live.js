// Shows the live state while streaming: ripples and a LIVE badge on the avatar,
// a "Live for 1h 12m · Game" line, the "Watch on Twitch" card and a red grid.
// Checks every minute while the tab is visible. A failed check keeps whatever
// the page was showing, unless there's been no good answer for a while, so a
// Twitch outage can't leave LIVE up after the stream ends.
const CHECK_EVERY_MS = 60_000;
const STALE_AFTER_MS = 5 * 60_000;

const liveItems = document.querySelectorAll('[data-live]');
const meta = document.querySelector('[data-live-meta]');
const detail = document.querySelector('[data-live-detail]');

let lastAnswerAt = 0;
let latestCheck = 0;

function formatUptime(startedMs) {
    const minutes = Math.max(0, Math.floor((Date.now() - startedMs) / 60_000));
    const hours = Math.floor(minutes / 60);
    return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function render(status) {
    const live = Boolean(status.live);
    document.body.classList.toggle('is-live', live);
    liveItems.forEach((el) => {
        el.hidden = !live;
    });
    if (!live) return;

    detail.textContent = status.title || 'Come hang out';
    const parts = [];
    const startedMs = Date.parse(status.startedAt);
    if (!Number.isNaN(startedMs)) parts.push(`Live for ${formatUptime(startedMs)}`);
    if (status.game) parts.push(status.game);
    meta.textContent = parts.join(' · ') || 'Live now';
}

async function check() {
    if (document.hidden) return;
    // The interval and a tab switch can overlap; only the newest check may render
    const thisCheck = ++latestCheck;
    let status = null;
    try {
        const res = await fetch('/api/twitch-live');
        if (res.ok) status = await res.json();
    } catch {
        // Network hiccup: handled below like any other failed check
    }
    if (thisCheck !== latestCheck) return;

    if (status) {
        lastAnswerAt = Date.now();
        render(status);
    } else if (Date.now() - lastAnswerAt > STALE_AFTER_MS) {
        render({ live: false });
    }
}

if (liveItems.length) {
    check();
    setInterval(check, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', check);
}
