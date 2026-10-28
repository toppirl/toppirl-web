// The gear dashboard on /admin. It edits the list /gear shows, drafts included, through
// netlify/functions/admin-gear.mjs: changes go into a local copy, which js/admin-save.js
// saves as you go. Like js/gear.js, everything is built with createElement and textContent,
// never innerHTML, so nothing typed into the list can add markup.
//
// The board is rebuilt from the local copy whenever things move, appear or go; focus goes
// back to the control with the same data-key. Typing only updates the card it's in, so a
// field never loses its caret mid-word.
import { loadGear, uploadPhoto } from './admin-api.js';
import { preparePhoto } from './admin-photo.js';
import { LIMITS, RULES } from './admin-rules.js';
import { EDIT_DELAY, TYPING_DELAY, createSaver } from './admin-save.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
    up: ['m18 15-6-6-6 6'],
    down: ['m6 9 6 6 6-6'],
    plus: ['M12 5v14', 'M5 12h14'],
    trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'm6 7 1 13h10l1-13', 'M9 7V4h6v3'],
    // A parcel, for gear without a photo (as on /gear)
    parcel: ['M21 8 12 3 3 8v8l9 5 9-5z', 'm3 8 9 5 9-5', 'M12 13v8', 'm7.5 5.5 9 5'],
};

// The item fields edited as text: [field, label, hint, input properties]
const ITEM_FIELDS = [
    ['name', 'Name', '', { required: true }],
    ['url', 'Link', 'The full address, starting with https://', {
        type: 'url', inputMode: 'url', autocapitalize: 'off', spellcheck: false, required: true,
    }],
    ['store', 'Store', 'Optional, like Amazon', {}],
    ['note', 'Note', `Optional, up to ${LIMITS.note} characters`, {}],
];
const PHOTO_HINT = 'JPEG, PNG or WebP. It’s cropped to a square, as /gear shows it.';
// Stands in for an item id when the photo belongs to the new-gear form
const NEW = 'new';

const board = document.querySelector('[data-board]');
const heading = document.querySelector('[data-board-heading]');
const previewNote = document.querySelector('[data-preview]');
const bar = document.querySelector('[data-save-bar]');
const statusText = document.querySelector('[data-save-status]');
const statusButton = document.querySelector('[data-save-action]');
const undoBar = document.querySelector('[data-undo]');
const undoText = document.querySelector('[data-undo-message]');
const undoButton = document.querySelector('[data-undo-button]');
const undoDismiss = document.querySelector('[data-undo-dismiss]');
const exportButton = document.querySelector('[data-export]');
const announcer = document.querySelector('[data-announce]');

let list = null;                    // { revision, savedAt, categories, items }, as edited here
let signedOutHook = () => {};
const open = new Set();             // items whose editor is open
const drafts = new Map();           // field key → { text, error }: typed text that isn't valid, so isn't in the list
const problems = new Map();         // field key → what the server said is wrong with it
let otherProblems = [];             // ...and what it said that isn't about one field
const uploads = new Map();          // item id or NEW → { busy, preview, error }
let adding = null;                  // the new-gear form, while it's open
let newCategory = { text: '', error: '' };
let deleting = null;                // { id, moveTo }: the category whose delete panel is open
let undo = null;                    // what the Undo button does
let statusAction = null;            // what the save bar's button does

const saver = createSaver({
    snapshot: () => structuredClone({ revision: list.revision, categories: list.categories, items: list.items }),
    saved: applySaved,
    conflict: applyConflict,
    problems: applyProblems,
    signedOut: () => signedOutHook(true),
    changed: renderStatus,
});

const findItem = (id) => list.items.find((item) => item.id === id);
const findCategory = (id) => list.categories.find((category) => category.id === id);
const itemsIn = (id) => list.items.filter((item) => item.category === id);
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const fieldError = (key) => drafts.get(key)?.error || problems.get(key) || '';
const busyUploads = () => [...uploads.values()].some((upload) => upload.busy);

function forget(prefix) {
    for (const map of [drafts, problems]) {
        for (const key of map.keys()) if (key.startsWith(prefix)) map.delete(key);
    }
}

// BUILDING BLOCKS

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

function lineIcon(paths) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'icon-line');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    for (const d of paths) {
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', d);
        svg.append(path);
    }
    return svg;
}

function button(text, className, key, onClick) {
    const node = el('button', className, text);
    node.type = 'button';
    if (key) node.dataset.key = key;
    if (onClick) node.addEventListener('click', onClick);
    return node;
}

// A disabled move button stays focusable (aria-disabled), so focus isn't lost when an
// item reaches the top
function iconButton(paths, label, key, onClick, { disabled = false, describedBy, className = '' } = {}) {
    const node = button('', `admin-icon-button ${className}`.trim(), key, () => {
        if (!disabled) onClick();
    });
    node.setAttribute('aria-label', label);
    if (describedBy) node.setAttribute('aria-describedby', describedBy);
    if (disabled) node.setAttribute('aria-disabled', 'true');
    node.append(lineIcon(paths));
    return node;
}

// A labelled text input, with its hint and error underneath, tied together for screen readers
function textField({ key, label, value, hint, error, properties = {} }) {
    const id = `field-${key.replaceAll('.', '-')}`;
    const wrap = el('div', 'admin-field');
    const labelNode = el('label', 'admin-label', label);
    labelNode.htmlFor = id;
    const input = el('input', 'admin-input');
    Object.assign(input, { id, type: 'text', autocomplete: 'off' }, properties);
    input.value = value;
    input.dataset.key = key;
    wrap.append(labelNode, input);

    const described = [];
    if (hint) {
        const hintNode = el('p', 'admin-hint', hint);
        hintNode.id = `${id}-hint`;
        described.push(hintNode.id);
        wrap.append(hintNode);
    }
    const errorNode = el('p', 'admin-error');
    errorNode.id = `${id}-error`;
    described.push(errorNode.id);
    wrap.append(errorNode);
    input.setAttribute('aria-describedby', described.join(' '));

    const field = { wrap, label: labelNode, input, error: errorNode };
    showError(field, error);
    return field;
}

function showError(field, message) {
    field.error.textContent = message;
    field.input.setAttribute('aria-invalid', String(Boolean(message)));
}

function checkbox(key, text, checked, onChange, describedBy) {
    const label = el('label', 'admin-check');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.dataset.key = key;
    if (describedBy) input.setAttribute('aria-describedby', describedBy);
    input.addEventListener('change', () => onChange(input.checked));
    label.append(input, el('span', null, text));
    return label;
}

function iconTile(className) {
    const tile = el('span', className);
    tile.append(lineIcon(ICONS.parcel));
    return tile;
}

function photoThumb(image, className) {
    if (!image) return iconTile(className);
    const img = el('img', className);
    img.alt = '';
    img.decoding = 'async';
    // A missing photo falls back to the icon tile instead of a broken image
    img.addEventListener('error', () => img.replaceWith(iconTile(className)), { once: true });
    img.src = image;
    return img;
}

function announce(message) {
    announcer.textContent = '';
    // A moment's gap, so the same message twice is still read out
    setTimeout(() => {
        announcer.textContent = message;
    }, 50);
}

// TEXT FIELDS

// Valid text goes straight into the list, and saves once typing pauses. Text that isn't
// valid stays in the field as a draft; its error shows once the field loses focus, then
// keeps up with typing until it's fixed.
function bindText(field, key, rule, commit) {
    const { input } = field;
    input.addEventListener('input', () => {
        const { value, error } = rule(input.value);
        if (error) {
            drafts.set(key, { text: input.value, error: drafts.get(key)?.error ? error : '' });
        } else {
            drafts.delete(key);
            problems.delete(key);
            commit(value);
        }
        showError(field, fieldError(key));
        renderStatus();
    });
    input.addEventListener('change', () => {
        const draft = drafts.get(key);
        if (draft) draft.error = rule(input.value).error;
        showError(field, fieldError(key));
        saver.soon();
        renderStatus();
    });
}

function updateItem(id, field, value) {
    const item = findItem(id);
    if (!item || item[field] === value) return;
    item[field] = value;
    saver.edit(TYPING_DELAY);
    board.querySelector(`[data-item="${CSS.escape(id)}"] .admin-item-text`)?.replaceWith(itemText(item));
}

function renameCategory(id, name) {
    const category = findCategory(id);
    if (!category || category.name === name) return;
    category.name = name;
    saver.edit(TYPING_DELAY);
    const title = document.getElementById(`category-${id}`);
    if (title) title.textContent = name;
    for (const option of board.querySelectorAll(`option[value="${CSS.escape(id)}"]`)) option.textContent = name;
}

// ITEMS

// The name, store and note, as /gear shows them, with a badge on drafts
function itemText(item) {
    const text = el('span', 'admin-item-text');
    if (item.hidden) text.append(el('span', 'admin-badge', 'Draft'));
    const title = el('span', 'link-title', item.name);
    title.id = `title-${item.id}`;
    text.append(title);
    if (item.store || item.note) {
        const meta = el('span', 'link-subtitle gear-meta');
        if (item.store) meta.append(el('span', 'gear-store', item.store));
        if (item.note) meta.append(el('span', null, item.note));
        text.append(meta);
    }
    return text;
}

function itemCard(item, position, count) {
    const id = item.id;
    const titleId = `title-${id}`;
    const card = el('li', item.hidden ? 'admin-item is-draft' : 'admin-item');
    card.dataset.item = id;

    const summary = el('div', 'admin-item-summary');
    summary.append(photoThumb(item.image, 'link-thumb'), itemText(item));

    const toggle = button('Edit', 'admin-button admin-button-quiet admin-button-small admin-edit', `item.${id}.edit`, () => {
        if (open.delete(id)) {
            // Closing drops text that never became valid, and old upload errors
            forget(`item.${id}.`);
            if (!uploads.get(id)?.busy) uploads.delete(id);
        } else {
            open.add(id);
        }
        render();
    });
    toggle.append(lineIcon(ICONS.down));
    toggle.setAttribute('aria-expanded', String(open.has(id)));
    toggle.setAttribute('aria-describedby', titleId);
    if (open.has(id)) toggle.setAttribute('aria-controls', `editor-${id}`);

    const actions = el('div', 'admin-item-actions');
    actions.append(
        iconButton(ICONS.up, 'Move up', `item.${id}.up`, () => moveItem(id, -1), { describedBy: titleId, disabled: position === 0 }),
        iconButton(ICONS.down, 'Move down', `item.${id}.down`, () => moveItem(id, 1), { describedBy: titleId, disabled: position === count - 1 }),
        checkbox(`item.${id}.shown`, 'On /gear', !item.hidden, (shown) => setShown(id, shown), titleId),
        toggle,
    );
    card.append(summary, actions);
    if (open.has(id)) card.append(itemEditor(item));
    return card;
}

function itemEditor(item) {
    const id = item.id;
    const editor = el('div', 'admin-editor');
    editor.id = `editor-${id}`;
    for (const [field, label, hint, properties] of ITEM_FIELDS) {
        const key = `item.${id}.${field}`;
        const input = textField({ key, label, hint, properties, value: drafts.get(key)?.text ?? item[field], error: fieldError(key) });
        bindText(input, key, RULES[field], (value) => updateItem(id, field, value));
        editor.append(input.wrap);
    }
    const remove = button('Delete this gear', 'admin-button admin-button-danger admin-button-small', `item.${id}.delete`, () => deleteItem(id));
    remove.prepend(lineIcon(ICONS.trash));
    editor.append(categoryField(item), photoField(id, item.image, problems.get(`item.${id}.photo`)), remove);
    return editor;
}

function categoryField(item) {
    const key = `item.${item.id}.category`;
    const id = `field-${key.replaceAll('.', '-')}`;
    const wrap = el('div', 'admin-field');
    const label = el('label', 'admin-label', 'Category');
    label.htmlFor = id;
    const select = el('select', 'admin-input admin-select');
    select.id = id;
    select.dataset.key = key;
    for (const category of list.categories) {
        const option = el('option', null, category.name);
        option.value = category.id;
        option.selected = category.id === item.category;
        select.append(option);
    }
    select.addEventListener('change', () => moveToCategory(item.id, select.value));
    wrap.append(label, select, el('p', 'admin-error', problems.get(key)));
    return wrap;
}

function moveItem(id, step) {
    const item = findItem(id);
    const group = itemsIn(item.category);
    const position = group.indexOf(item) + step;
    const other = group[position];
    if (!other) return;
    // Swapping the two leaves other categories' items where they were
    const a = list.items.indexOf(item);
    const b = list.items.indexOf(other);
    [list.items[a], list.items[b]] = [list.items[b], list.items[a]];
    saver.edit();
    render();
    announce(`Moved “${item.name}” ${step < 0 ? 'up' : 'down'}, to ${position + 1} of ${group.length}`);
}

// A moved item goes to the end of its new category
function moveToCategory(id, categoryId) {
    const index = list.items.findIndex((item) => item.id === id);
    const [item] = list.items.splice(index, 1);
    item.category = categoryId;
    list.items.push(item);
    problems.delete(`item.${id}.category`);
    saver.edit();
    render();
    announce(`Moved “${item.name}” to “${findCategory(categoryId).name}”`);
}

function setShown(id, shown) {
    const item = findItem(id);
    item.hidden = !shown;
    saver.edit();
    render();
    announce(shown ? `“${item.name}” is on /gear` : `“${item.name}” is hidden from /gear`);
}

function deleteItem(id) {
    const index = list.items.findIndex((item) => item.id === id);
    const [item] = list.items.splice(index, 1);
    const kept = keepPhoto(item.image);
    open.delete(id);
    uploads.delete(id);
    forget(`item.${id}.`);
    saver.edit();
    offerUndo(`Deleted “${item.name}”.`, () => {
        list.items.splice(Math.min(index, list.items.length), 0, { ...item, image: null });
        saver.edit();
        render(`item.${id}.edit`);
        announce(`Brought back “${item.name}”.`);
        // Its photo was deleted with it, so it goes up again
        if (item.image) restorePhoto(id, kept);
    });
    render('undo');
}

// PHOTOS

// owner is an item id, or NEW for the new-gear form. There's no blob: preview (the CSP
// blocks it): a photo being uploaded shows on its canvas, an uploaded one from the API.
function photoField(owner, image, problem) {
    const key = owner === NEW ? 'new.photo' : `item.${owner}.photo`;
    const id = `field-${key.replaceAll('.', '-')}`;
    const upload = uploads.get(owner) ?? {};
    const group = el('div', 'admin-field');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-labelledby', `${id}-label`);
    const label = el('p', 'admin-label', 'Photo');
    label.id = `${id}-label`;

    const preview = upload.preview ?? photoThumb(image, 'admin-photo-preview');
    preview.classList.add('admin-photo-preview');

    const file = el('input');
    file.type = 'file';
    file.accept = 'image/jpeg,image/png,image/webp';
    file.hidden = true;
    file.dataset.key = `${key}.file`;
    file.addEventListener('change', () => {
        const [picked] = file.files;
        if (picked) addPhoto(owner, picked);
    });

    const failed = upload.error || problem;
    const note = el('p', failed ? 'admin-error' : 'admin-hint', failed || (upload.busy ? 'Uploading…' : PHOTO_HINT));
    note.id = `${id}-note`;

    const pick = button(image ? 'Replace photo' : 'Add photo', 'admin-button admin-button-quiet admin-button-small', `${key}.pick`, () => {
        if (!upload.busy) file.click();
    });
    pick.setAttribute('aria-describedby', note.id);
    if (upload.busy) pick.setAttribute('aria-disabled', 'true');
    const controls = el('div', 'admin-photo-controls');
    controls.append(pick);
    if (image && !upload.busy) {
        controls.append(button('Remove photo', 'admin-button admin-button-quiet admin-button-small', `${key}.remove`, () => removePhoto(owner)));
    }

    const body = el('div', 'admin-photo');
    body.append(preview, controls);
    group.append(label, body, note, file);
    return group;
}

// Resizes a picked photo and uploads it, then puts it on the item or the new-gear form
async function addPhoto(owner, file) {
    uploads.set(owner, { busy: true });
    render();
    let prepared;
    try {
        prepared = await preparePhoto(file);
    } catch (err) {
        return photoDone(owner, { error: err.message });
    }
    uploads.set(owner, { busy: true, preview: prepared.preview });
    render();
    photoDone(owner, await uploadPhoto(prepared.photo));
}

// Undo needs a photo's bytes after the save that drops it has deleted it from the store,
// so they're fetched (usually from the browser's cache) as it's removed
function keepPhoto(image) {
    if (!image) return Promise.resolve(null);
    return fetch(image).then((res) => (res.ok ? res.blob() : null), () => null);
}

async function restorePhoto(owner, kept) {
    uploads.set(owner, { busy: true });
    render();
    const photo = await kept;
    photoDone(owner, photo ? await uploadPhoto(photo) : { error: "The photo couldn't be brought back. Add it again." });
}

// Takes an upload's answer, or { error } if it never got that far
function photoDone(owner, { status, data, error }) {
    if (!list) return;
    if (status === 401) {
        uploads.delete(owner);
        return signedOutHook(hasUnsavedWork());
    }
    if (status !== 201) {
        const message = error ?? data.error;
        uploads.set(owner, { error: message });
        render();
        return announce(message);
    }

    uploads.delete(owner);
    if (owner === NEW) {
        if (adding) adding.image = data.image;
    } else {
        const item = findItem(owner);
        if (!item) return render();
        item.image = data.image;
        problems.delete(`item.${owner}.photo`);
        saver.edit();
    }
    render();
    announce('Photo added');
}

function removePhoto(owner) {
    if (owner === NEW) {
        adding.image = null;
        return render('new.photo.pick');
    }
    const item = findItem(owner);
    const kept = keepPhoto(item.image);
    item.image = null;
    problems.delete(`item.${owner}.photo`);
    saver.edit();
    offerUndo(`Removed the photo from “${item.name}”.`, () => {
        if (!findItem(owner)) return;
        open.add(owner);
        render(`item.${owner}.photo.pick`);
        restorePhoto(owner, kept);
    });
    render(`item.${owner}.photo.pick`);
}

// ADDING GEAR

const blankNewItem = () => ({ category: null, name: '', url: '', store: '', note: '', image: null, shown: true, errors: {} });

function addButton(categoryId, titleId) {
    if (list.items.length >= LIMITS.items) {
        return el('p', 'admin-empty', `The list has ${LIMITS.items} items, the most it can hold.`);
    }
    const add = button('Add gear', 'admin-add', `cat.${categoryId}.add`, () => {
        // The form moves here if it was open somewhere else, keeping what's typed
        adding = { ...(adding ?? blankNewItem()), category: categoryId };
        render('new.name');
    });
    add.prepend(lineIcon(ICONS.plus));
    add.setAttribute('aria-describedby', titleId);
    return add;
}

// Errors show on Add, or when a field with something in it loses focus
function newItemForm() {
    const form = el('form', 'admin-new-item');
    form.noValidate = true;
    const title = el('h4', 'admin-form-title', 'New gear');
    title.id = 'new-item-title';
    form.setAttribute('aria-labelledby', title.id);
    form.append(title);

    for (const [field, label, hint, properties] of ITEM_FIELDS) {
        const input = textField({ key: `new.${field}`, label, hint, properties, value: adding[field], error: adding.errors[field] });
        const check = () => {
            adding.errors[field] = RULES[field](input.input.value).error;
            showError(input, adding.errors[field]);
        };
        input.input.addEventListener('input', () => {
            adding[field] = input.input.value;
            if (adding.errors[field]) check();
        });
        input.input.addEventListener('change', () => {
            if (input.input.value.trim()) check();
        });
        form.append(input.wrap);
    }

    const actions = el('div', 'admin-row admin-form-actions');
    const submit = button('Add', 'admin-button admin-button-small', 'new.submit');
    submit.type = 'submit';
    actions.append(submit, button('Cancel', 'admin-button admin-button-quiet admin-button-small', 'new.cancel', closeNewItem));
    form.append(
        photoField(NEW, adding.image, adding.errors.photo),
        checkbox('new.shown', 'Show on /gear straight away', adding.shown, (shown) => {
            adding.shown = shown;
        }),
        actions,
    );
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        submitNewItem();
    });
    form.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeNewItem();
    });
    return form;
}

function closeNewItem() {
    const categoryId = adding.category;
    adding = null;
    uploads.delete(NEW);
    render(`cat.${categoryId}.add`);
}

function submitNewItem() {
    const values = {};
    adding.errors = {};
    for (const [field] of ITEM_FIELDS) {
        const { value, error } = RULES[field](adding[field]);
        if (error) adding.errors[field] = error;
        else values[field] = value;
    }
    if (uploads.get(NEW)?.busy) adding.errors.photo = 'Wait for the photo to finish uploading.';
    const first = [...ITEM_FIELDS.map(([field]) => field), 'photo'].find((field) => adding.errors[field]);
    if (first) return render(first === 'photo' ? 'new.photo.pick' : `new.${first}`);

    // Same key order as the server stores, so a saved copy compares equal
    const item = {
        id: crypto.randomUUID(),
        name: values.name,
        url: values.url,
        note: values.note,
        store: values.store,
        category: adding.category,
        image: adding.image,
        hidden: !adding.shown,
    };
    list.items.push(item);
    adding = null;
    saver.edit(0);
    render(`item.${item.id}.edit`);
    announce(`Added “${item.name}”.`);
}

// CATEGORIES

function categorySection(category, index) {
    const id = category.id;
    const items = itemsIn(id);
    const titleId = `category-${id}`;
    const section = el('section', 'admin-category');
    section.setAttribute('aria-labelledby', titleId);
    // The name field reads as the heading; this one is for jumping between categories
    const title = el('h3', 'visually-hidden', category.name);
    title.id = titleId;

    const nameKey = `cat.${id}.name`;
    const name = textField({ key: nameKey, label: 'Category', value: drafts.get(nameKey)?.text ?? category.name, error: fieldError(nameKey) });
    name.label.className = 'admin-kicker';
    name.input.classList.add('admin-category-name');
    bindText(name, nameKey, RULES.categoryName, (value) => renameCategory(id, value));
    const row = el('div', 'admin-row');
    name.input.replaceWith(row);
    row.append(
        name.input,
        iconButton(ICONS.up, 'Move category up', `cat.${id}.up`, () => moveCategory(id, -1), { describedBy: titleId, disabled: index === 0 }),
        iconButton(ICONS.down, 'Move category down', `cat.${id}.down`, () => moveCategory(id, 1), {
            describedBy: titleId, disabled: index === list.categories.length - 1,
        }),
        iconButton(ICONS.trash, 'Delete category', `cat.${id}.delete`, () => askDeleteCategory(id), {
            describedBy: titleId, className: 'admin-icon-button-danger',
        }),
    );
    section.append(title, name.wrap);
    if (deleting?.id === id) section.append(deletePanel(category, items.length));

    if (items.length) {
        const cards = el('ol', 'admin-items');
        // The reset strips list styling, which makes Safari stop calling it a list
        cards.setAttribute('role', 'list');
        cards.append(...items.map((item, i) => itemCard(item, i, items.length)));
        section.append(cards);
    } else {
        section.append(el('p', 'admin-empty', 'No gear in this category yet.'));
    }
    section.append(adding?.category === id ? newItemForm() : addButton(id, titleId));
    return section;
}

function moveCategory(id, step) {
    const index = list.categories.findIndex((category) => category.id === id);
    const other = index + step;
    if (other < 0 || other >= list.categories.length) return;
    const categories = list.categories;
    [categories[index], categories[other]] = [categories[other], categories[index]];
    saver.edit();
    render();
    announce(`Moved “${categories[other].name}” ${step < 0 ? 'up' : 'down'}, to ${other + 1} of ${categories.length}`);
}

// A category with gear in it can only go once its gear has somewhere else to go
function askDeleteCategory(id) {
    if (!itemsIn(id).length) return deleteCategory(id, null);
    const moveTo = list.categories.find((category) => category.id !== id)?.id ?? null;
    deleting = { id, moveTo };
    render(moveTo ? `cat.${id}.move-to` : `cat.${id}.cancel`);
}

function deletePanel(category, count) {
    const id = category.id;
    const panel = el('div', 'admin-confirm');
    const others = list.categories.filter((other) => other.id !== id);
    const cancel = button(others.length ? 'Cancel' : 'OK', 'admin-button admin-button-quiet admin-button-small', `cat.${id}.cancel`, () => {
        deleting = null;
        render(`cat.${id}.delete`);
    });
    panel.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') cancel.click();
    });

    const message = `“${category.name}” still has ${plural(count, 'item')}.`;
    if (!others.length) {
        panel.append(el('p', null, `${message} Delete them, or add another category to move them to, first.`), cancel);
        return panel;
    }
    const selectId = `field-cat-${id}-move-to`;
    const label = el('label', 'admin-label', `${message} Move them to:`);
    label.htmlFor = selectId;
    const select = el('select', 'admin-input admin-select');
    select.id = selectId;
    select.dataset.key = `cat.${id}.move-to`;
    for (const other of others) {
        const option = el('option', null, other.name);
        option.value = other.id;
        option.selected = other.id === deleting.moveTo;
        select.append(option);
    }
    select.addEventListener('change', () => {
        deleting.moveTo = select.value;
    });
    const actions = el('div', 'admin-row admin-form-actions');
    actions.append(
        button('Move and delete', 'admin-button admin-button-danger admin-button-small', `cat.${id}.confirm`, () => deleteCategory(id, select.value)),
        cancel,
    );
    panel.append(label, select, actions);
    return panel;
}

// Moved items go to the end of their new category, in the order they had
function deleteCategory(id, moveTo) {
    if (moveTo && !findCategory(moveTo)) return;
    const index = list.categories.findIndex((category) => category.id === id);
    const [category] = list.categories.splice(index, 1);
    const moving = list.items.filter((item) => item.category === id);
    const moved = moving.map((item) => item.id);
    if (moveTo) {
        for (const item of moving) item.category = moveTo;
        list.items = [...list.items.filter((item) => !moving.includes(item)), ...moving];
    }
    deleting = null;
    forget(`cat.${id}.`);
    if (adding?.category === id) adding = null;
    saver.edit();

    const target = moveTo ? findCategory(moveTo).name : '';
    const message = moved.length
        ? `Deleted “${category.name}” and moved ${plural(moved.length, 'item')} to “${target}”.`
        : `Deleted “${category.name}”.`;
    offerUndo(message, () => {
        list.categories.splice(Math.min(index, list.categories.length), 0, category);
        for (const item of list.items) {
            if (moved.includes(item.id) && item.category === moveTo) item.category = id;
        }
        saver.edit();
        render(`cat.${id}.name`);
        announce(`Brought back “${category.name}”.`);
    });
    render('undo');
}

function newCategoryForm() {
    const form = el('form', 'admin-card admin-new-category');
    form.noValidate = true;
    const field = textField({
        key: 'new-category',
        label: 'New category',
        hint: list.categories.length ? '' : 'Like Audio, Camera or Desk',
        value: newCategory.text,
        error: newCategory.error,
        properties: { required: true },
    });
    const add = button('Add', 'admin-button admin-button-small', 'new-category.add');
    add.type = 'submit';
    const row = el('div', 'admin-row');
    field.input.replaceWith(row);
    row.append(field.input, add);
    field.input.addEventListener('input', () => {
        newCategory.text = field.input.value;
        if (newCategory.error) {
            newCategory.error = RULES.categoryName(field.input.value).error ?? '';
            showError(field, newCategory.error);
        }
    });
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        addCategory();
    });
    form.append(field.wrap);
    return form;
}

function addCategory() {
    let { value, error } = RULES.categoryName(newCategory.text);
    if (!error && list.categories.length >= LIMITS.categories) {
        error = `The list has ${LIMITS.categories} categories, the most it can hold`;
    }
    if (error) {
        newCategory.error = error;
        return render('new-category');
    }
    list.categories.push({ id: crypto.randomUUID(), name: value });
    newCategory = { text: '', error: '' };
    saver.edit(0);
    // Focus stays here, for adding another
    render('new-category');
    announce(`Added the category “${value}”.`);
}

// THE BOARD

function render(focusKey) {
    if (!list) return;
    const active = document.activeElement;
    const key = focusKey ?? active?.dataset?.key;
    let selection = null;
    if (!focusKey && typeof active?.selectionStart === 'number') selection = [active.selectionStart, active.selectionEnd];

    if (list.categories.length) {
        board.replaceChildren(...list.categories.map(categorySection), newCategoryForm());
    } else {
        const empty = el('div', 'gear-status');
        empty.append(
            el('p', 'gear-status-title', 'No gear yet'),
            el('p', 'link-subtitle', 'Add a category first, like Audio or Camera, then add gear to it.'),
        );
        board.replaceChildren(empty, newCategoryForm());
    }
    renderStatus();

    const target = key && document.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (!target) return;
    target.focus();
    if (selection) target.setSelectionRange(...selection);
}

function boardMessage(title, detail, retry) {
    const box = el('div', 'gear-status');
    box.setAttribute('role', 'status');
    box.append(el('p', 'gear-status-title', title));
    if (detail) box.append(el('p', 'link-subtitle', detail));
    if (retry) box.append(button('Try again', 'admin-button admin-button-small', 'load.retry', load));
    board.replaceChildren(box);
}

function describeSave() {
    const { phase, error } = saver.state();
    if (phase === 'pending') return { tone: 'busy', text: 'Saving…' };
    if (phase === 'failed') return { tone: 'error', text: `Not saved. ${error}`, action: { label: 'Retry', run: saver.retry } };
    if (phase === 'problems') return { tone: 'error', text: [error, ...otherProblems].join('. ') };
    if (phase === 'conflict') {
        return {
            tone: 'error',
            text: "Your last change wasn't saved: the list was changed somewhere else, maybe in another tab. This is that version now, so make your change again.",
        };
    }
    if (phase === 'stale') {
        return { tone: 'warn', text: 'Saved, but /gear may still show the old list.', action: { label: 'Save again', run: saver.saveAgain } };
    }
    if (phase === 'signed-out') return { tone: 'error', text: 'Signed out. Sign in again to save your last change.' };
    if (busyUploads()) return { tone: 'busy', text: 'Uploading the photo…' };
    if (drafts.size) return { tone: 'warn', text: `Not saved yet: ${plural(drafts.size, 'field')} to fix` };
    return { tone: 'saved', text: 'All changes saved' };
}

function renderStatus() {
    if (!list) return;
    const { tone, text, action } = describeSave();
    bar.className = `admin-bar is-${tone}`;
    // Setting the same text again can make screen readers repeat it
    if (statusText.textContent !== text) statusText.textContent = text;
    statusAction = action?.run ?? null;
    if (action) statusButton.textContent = action.label;
    if (!action && document.activeElement === statusButton) heading.focus();
    statusButton.hidden = !action;
}

function offerUndo(message, run) {
    undo = run;
    undoText.textContent = message;
    undoBar.hidden = false;
}

function clearUndo() {
    undo = null;
    undoBar.hidden = true;
}

// LOADING AND SAVING

function setList(data) {
    list = { revision: data.revision, savedAt: data.savedAt, categories: data.categories, items: data.items };
    previewNote.hidden = data.preview !== true;
    bar.hidden = false;
    exportButton.disabled = false;
    for (const id of open) if (!findItem(id)) open.delete(id);
    if (adding && !findCategory(adding.category)) adding = null;
    if (deleting && !findCategory(deleting.id)) deleting = null;
}

async function load() {
    list = null;
    bar.hidden = true;
    exportButton.disabled = true;
    boardMessage('Loading the gear list…');
    const { status, data } = await loadGear();
    if (status === 401) return signedOutHook(false);
    if (status !== 200) return boardMessage("Couldn't load the gear list", data.error, true);
    setList(data);
    render();
}

function applySaved(data, newer) {
    if (!list) return;
    list.revision = data.revision;
    list.savedAt = data.savedAt;
    const hadProblems = problems.size > 0 || otherProblems.length > 0;
    problems.clear();
    otherProblems = [];
    // The server trims text and tidies links just as the dashboard does, so its copy
    // rarely differs. Edits made since stay as they are, and go in the next save.
    const differs = !newer && JSON.stringify([data.categories, data.items]) !== JSON.stringify([list.categories, list.items]);
    if (differs) {
        list.categories = data.categories;
        list.items = data.items;
    }
    if (differs || hadProblems) render();
}

function applyConflict(current) {
    if (!list) return;
    setList(current);
    drafts.clear();
    problems.clear();
    otherProblems = [];
    clearUndo();
    render();
}

// Puts each problem the server found next to its field, by its path (like items[3].url)
function applyProblems(found, sent) {
    if (!list) return;
    problems.clear();
    otherProblems = [];
    for (const { path, message } of found) {
        const [, kind, index, field] = /^(items|categories)\[(\d+)\]\.(\w+)$/.exec(path) ?? [];
        const entry = kind ? sent[kind][Number(index)] : null;
        const key = entry && problemKey(kind, entry.id, field);
        if (key) {
            problems.set(key, message);
            if (kind === 'items') open.add(entry.id);
            // The server's word on a photo replaces an older upload error
            if (field === 'image' && !uploads.get(entry.id)?.busy) uploads.delete(entry.id);
        } else {
            otherProblems.push(message);
        }
    }
    render();
}

function problemKey(kind, id, field) {
    if (kind === 'categories') return field === 'name' && findCategory(id) ? `cat.${id}.name` : null;
    if (!findItem(id)) return null;
    if (field === 'image') return `item.${id}.photo`;
    return ['name', 'url', 'store', 'note', 'category'].includes(field) ? `item.${id}.${field}` : null;
}

// A copy of the list as it is here, drafts included, in the shape it's stored in
function exportList() {
    if (!list) return;
    const data = { revision: list.revision, savedAt: list.savedAt, categories: list.categories, items: list.items };
    const file = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' });
    const link = el('a');
    link.href = URL.createObjectURL(file);
    // en-CA writes the local date as YYYY-MM-DD
    link.download = `toppirl-gear-${new Date().toLocaleDateString('en-CA')}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
}

export function hasUnsavedWork() {
    const typed = adding && (adding.name || adding.url || adding.store || adding.note || adding.image);
    return saver.unsaved() || drafts.size > 0 || busyUploads() || Boolean(typed) || Boolean(newCategory.text.trim());
}

// onSignedOut(unsaved) runs if the session ends mid-edit; unsaved says whether an edit
// is still waiting, which happens once signed in again
export function openDashboard({ onSignedOut }) {
    signedOutHook = onSignedOut;
    if (list && saver.unsaved()) saver.retry();
    else load();
}

export function closeDashboard() {
    saver.reset();
    list = null;
    open.clear();
    drafts.clear();
    problems.clear();
    uploads.clear();
    otherProblems = [];
    adding = null;
    deleting = null;
    newCategory = { text: '', error: '' };
    clearUndo();
    board.replaceChildren();
    previewNote.hidden = true;
    bar.hidden = true;
}

// Resolves to false if something couldn't be saved, so signing out would lose it
export const saveBeforeSignOut = () => saver.flush();

statusButton.addEventListener('click', () => statusAction?.());
undoButton.addEventListener('click', () => {
    const run = undo;
    clearUndo();
    run?.();
});
undoDismiss.addEventListener('click', () => {
    clearUndo();
    heading.focus();
});
exportButton.addEventListener('click', exportList);

addEventListener('beforeunload', (event) => {
    if (!hasUnsavedWork()) return;
    event.preventDefault();
    // Older browsers need this too
    event.returnValue = '';
});

// Coming back to the tab picks up edits saved elsewhere (another tab, the phone), so they
// don't end in a conflict. Only when there's nothing here that a reload would lose.
document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !list || hasUnsavedWork() || undo) return;
    const { status, data } = await loadGear();
    if (status !== 200 || !list || hasUnsavedWork() || data.revision === list.revision) return;
    setList(data);
    render();
    announce('Updated with changes saved somewhere else');
});
