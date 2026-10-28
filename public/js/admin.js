// Sign-in for /admin. The CSP blocks native form posts, so the form goes through fetch.
// The session itself is an HttpOnly cookie this script never sees; /api/admin/session
// says whether it's valid. Signed in, the page is the gear dashboard (js/admin-gear.js).
import { closeDashboard, openDashboard, saveBeforeSignOut } from './admin-gear.js';

const status = document.querySelector('[data-admin-status]');
const form = document.querySelector('[data-signin]');
const password = form.elements.password;
const signInButton = form.querySelector('[type="submit"]');
const error = document.querySelector('[data-signin-error]');
const sessionPanel = document.querySelector('[data-signed-in]');
const dashboardHeading = document.querySelector('[data-board-heading]');
const signOutButton = document.querySelector('[data-signout]');

function render(signedIn) {
    form.hidden = signedIn;
    sessionPanel.hidden = !signedIn;
    status.textContent = signedIn ? 'Signed in. Changes save as you go.' : 'Enter the password to continue.';
    if (signedIn) openDashboard({ onSignedOut: sessionEnded });
}

// The session ran out (or the password changed) while the dashboard was open. An edit
// that couldn't save is kept, and goes once signed in again.
function sessionEnded(unsaved) {
    render(false);
    showError(unsaved
        ? "You've been signed out, so your last change isn't saved yet. Sign in again to save it."
        : "You've been signed out. Sign in again to carry on.");
    password.focus();
}

// `wrongPassword` marks the field invalid; other errors aren't the field's fault
function showError(message, wrongPassword = false) {
    error.textContent = message;
    password.setAttribute('aria-invalid', String(wrongPassword));
}

function lockoutMessage(res) {
    const minutes = Math.ceil((Number(res.headers.get('Retry-After')) || 60) / 60);
    return `Too many sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

async function serverMessage(res) {
    try {
        const { error: message } = await res.json();
        if (message) return message;
    } catch {
        // No JSON body: fall back to the status code
    }
    return `Sign-in failed (error ${res.status}). Try again.`;
}

async function checkSession() {
    try {
        const res = await fetch('/api/admin/session');
        if (!res.ok) throw new Error(`Session check failed: ${res.status}`);
        const { signedIn } = await res.json();
        render(signedIn === true);
    } catch {
        render(false);
        showError("Couldn't check whether you're signed in. Reload to try again.");
    }
}

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (signInButton.disabled) return;

    // Clearing first means a repeat of the same error is announced again
    showError('');
    signInButton.disabled = true;
    let res = null;
    try {
        res = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: password.value }),
        });
    } catch {
        // Offline or blocked: reported below
    }
    signInButton.disabled = false;

    if (res?.status === 204) {
        form.reset();
        showError('');
        render(true);
        dashboardHeading.focus();
        return;
    }

    if (!res) {
        showError("Couldn't reach the server. Check your connection and try again.");
    } else if (res.status === 401) {
        showError("That password isn't right.", true);
    } else if (res.status === 429) {
        showError(lockoutMessage(res));
    } else {
        showError(await serverMessage(res));
    }
    password.focus();
    password.select();
});

signOutButton.addEventListener('click', async () => {
    signOutButton.disabled = true;
    // Whatever's waiting to save goes first, so signing out never drops an edit
    const saved = await saveBeforeSignOut();
    if (sessionPanel.hidden) {
        // The session had already ended: sessionEnded has shown the sign-in form
        signOutButton.disabled = false;
        return;
    }
    if (!saved) {
        signOutButton.disabled = false;
        status.textContent = "Still signed in: your last change hasn't saved yet. Try again.";
        signOutButton.focus();
        return;
    }

    let signedOut = false;
    try {
        signedOut = (await fetch('/api/admin/logout', { method: 'POST' })).ok;
    } catch {
        // Offline or blocked: reported below
    }
    signOutButton.disabled = false;

    if (signedOut) {
        closeDashboard();
        showError('');
        render(false);
        password.focus();
    } else {
        status.textContent = "Still signed in: couldn't sign out. Try again.";
        signOutButton.focus();
    }
});

checkSession();
