// Shows the live state while streaming: ripples and a LIVE badge on the avatar,
// a "Live for 1h 12m · Game" line, the "Watch on Twitch" card and a red grid.
// Checks every minute while the tab is visible. A failed check keeps whatever
// the page was showing, so the live state doesn't flicker.
const CHECK_EVERY_MS = 60_000;

const liveItems = document.querySelectorAll('[data-live]');
const meta = document.querySelector('[data-live-meta]');
const detail = document.querySelector('[data-live-detail]');

function formatUptime(startedAt) {
    const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 60_000));
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
    if (status.startedAt) parts.push(`Live for ${formatUptime(status.startedAt)}`);
    if (status.game) parts.push(status.game);
    meta.textContent = parts.join(' · ') || 'Live now';
}

async function check() {
    if (document.hidden) return;
    try {
        const res = await fetch('/api/twitch-live');
        if (res.ok) render(await res.json());
    } catch {
        // Network hiccup: keep the last known state
    }
}

if (liveItems.length) {
    check();
    setInterval(check, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', check);
}
