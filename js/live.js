// Shows the "Live now" card while streaming. If the check fails or the stream
// is offline, the card stays hidden and the page looks exactly as it did.
const liveItem = document.querySelector('[data-live]');

async function showLiveStatus() {
    const res = await fetch('/api/twitch-live');
    if (!res.ok) return;

    const status = await res.json();
    if (!status.live) return;

    const detail = [status.title, status.game].filter(Boolean).join(' · ');
    if (detail) {
        liveItem.querySelector('[data-live-detail]').textContent = detail;
    }
    liveItem.hidden = false;
    document.body.classList.add('is-live');
}

if (liveItem) {
    showLiveStatus().catch(() => {});
}
