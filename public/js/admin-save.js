// Saves the gear list as it's edited, so the dashboard has no Save button. Typing waits for
// a pause, other edits go almost at once, only one save is ever in flight, and edits made
// while one is go out together once it's back. The answers a save can get are described
// in netlify/functions/admin-gear.mjs.
import { saveGear } from './admin-api.js';

// How long to wait after the last keystroke, and after anything else (so a few quick
// clicks of a move button go as one save)
export const TYPING_DELAY = 1000;
export const EDIT_DELAY = 250;

// snapshot() gives the list to send, as { revision, categories, items }. The hooks hear
// what each answer means:
//     saved(list, newer)       200: list is as stored; newer means there are edits since,
//                              which go next
//     conflict(current)        409: nothing was saved, and current is the list as it is now
//     problems(found, sent)    400: found is [{ path, message }], with paths into `sent`
//     signedOut()              401
//     changed()                state() changed
// state().phase is one of:
//     idle         everything's saved
//     pending      edits are waiting to go, or on their way
//     stale        saved, but the CDN may still have the old public list (offer saveAgain)
//     conflict     the latest edits were dropped for someone else's
//     problems     the server refused the list; the next edit tries again
//     failed       couldn't save (state().error says why); retry or the next edit tries again
//     signed-out   retry once signed in again
export function createSaver({ snapshot, saved, conflict, problems, signedOut, changed }) {
    let edits = 0;          // edits made, counted
    let settled = 0;        // how many of those the server has saved, or dropped for a conflict
    let again = false;      // send even with no new edits ("Save again")
    let timer = null;
    let inFlight = null;    // the save on its way
    let phase = 'idle';
    let error = '';

    const waiting = () => edits > settled || again;
    // After these, saving waits for the next edit or a retry, so a refusal can't loop
    const held = () => ['problems', 'failed', 'signed-out'].includes(phase);

    function set(next, message = '') {
        phase = next;
        error = message;
        changed();
    }

    function schedule(delay) {
        clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            send();
        }, delay);
    }

    async function send() {
        if (inFlight || held() || !waiting()) return;
        const upTo = edits;
        const body = snapshot();
        again = false;
        inFlight = saveGear(body);
        set('pending');
        const { status, data } = await inFlight;
        inFlight = null;
        settle(status, data, upTo, body);
        // Edits made meanwhile go now, unless they're still being typed
        if (waiting() && !held() && !timer) send();
    }

    function settle(status, data, upTo, body) {
        if (status === 200) {
            settled = upTo;
            saved(data, edits > upTo);
            if (waiting()) set('pending');
            else set(data.cachePurged === false ? 'stale' : 'idle');
        } else if (status === 409 && data.current) {
            settled = edits;
            again = false;
            conflict(data.current);
            set('conflict', data.error);
        } else if (status === 400 && Array.isArray(data.problems)) {
            problems(data.problems, body);
            set('problems', data.error);
        } else if (status === 401) {
            set('signed-out');
            signedOut();
        } else {
            set('failed', data.error);
        }
    }

    return {
        state: () => ({ phase, error }),
        // True while anything is waiting to save or on its way
        unsaved: () => waiting() || inFlight !== null,
        edit(delay = EDIT_DELAY) {
            edits++;
            set('pending');
            schedule(delay);
        },
        // A field lost focus: send what was typed without waiting out the pause
        soon() {
            if (timer) schedule(0);
        },
        retry() {
            set(waiting() ? 'pending' : 'idle');
            send();
        },
        saveAgain() {
            again = true;
            set('pending');
            send();
        },
        // Sends whatever's waiting now. Resolves to true once it's all saved.
        async flush() {
            clearTimeout(timer);
            timer = null;
            if (held()) set(waiting() ? 'pending' : 'idle');
            while (inFlight || (waiting() && !held())) await (inFlight ?? send());
            return !waiting();
        },
        reset() {
            clearTimeout(timer);
            timer = null;
            edits = 0;
            settled = 0;
            again = false;
            phase = 'idle';
            error = '';
        },
    };
}
