// Puts the retro grid's horizon one card-gap above the link cards, so the
// grid always starts just under the social icons, whatever the screen size.
const root = document.documentElement;
const page = document.querySelector('.page');
const links = document.querySelector('.links');

function placeHorizon() {
    const gap = parseFloat(getComputedStyle(links).rowGap) || 12;
    const top = links.getBoundingClientRect().top + window.scrollY;
    root.style.setProperty('--horizon', `${Math.round(top - gap)}px`);
}

if (page && links) {
    placeHorizon();
    // Re-place it whenever the layout shifts: fonts loading, the live line or card appearing
    new ResizeObserver(placeHorizon).observe(page);
    window.addEventListener('resize', placeHorizon);
}
