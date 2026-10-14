/**
 * Zenith Academy Scroll — data layer
 *
 * Everything that reads or writes actor flags, plus the derived reads the UI
 * needs (marks, portraits, unread counts, the notification log).
 *
 * The one rule that matters here: saves use nested object notation
 * (`{flags: {[M]: {[section]: data}}}`), never a dot-path like
 * `flags.zenith-scroll.academic`. Foundry's path parser misreads the hyphen in
 * the module id and the write silently fails.
 */

import {
  M, F, app, genId, uid, convId, notifId, currencyList, primaryCurrency, safeImageSrc,
} from "./core.mjs";
import { getAnnouncements, getMaps } from "./world.mjs";

// ---------------------------------------------------------------------------
//  Derived reads
// ---------------------------------------------------------------------------

/**
 * Currency is an inventory item on the actor, not a flag.
 *
 * Astras and Marks both store their amount in `system.quantity`, which is why
 * one shape covers both and no configurable path is needed. A missing or
 * renamed item reads 0 rather than throwing — a student who has never been paid
 * simply has no item.
 */
export function currencyItem(a, cur) {
  if (!a || !cur?.itemName) return null;
  const target = String(cur.itemName).toLowerCase();
  return a.items?.find(x => x.name?.toLowerCase() === target) ?? null;
}

/** One balance, by currency key. */
export function getCurrency(a, key) {
  const cur = currencyList().find(c => c.key === key);
  if (!cur) return 0;
  return Number(currencyItem(a, cur)?.system?.quantity) || 0;
}

/** Every configured currency with this student's balance attached. */
export function getBalances(a) {
  return currencyList().map(c => ({ ...c, amount: Number(currencyItem(a, c)?.system?.quantity) || 0 }));
}

/**
 * Marks, kept as a thin alias so nothing that already reads it breaks.
 *
 * The legacy `marksItemName` setting still wins when it has been changed away
 * from its default, because a world that renamed its currency before v1.8 would
 * otherwise silently zero every student's balance on upgrade.
 */
export function getMarks(a) {
  if (!a) return 0;
  let legacy = "";
  try { legacy = String(game.settings.get(M, "marksItemName") || ""); } catch (e) { /* unregistered */ }
  if (legacy && legacy.toLowerCase() !== "marks") {
    const i = a.items?.find(x => x.name?.toLowerCase() === legacy.toLowerCase());
    return Number(i?.system?.quantity) || 0;
  }
  const primary = currencyList().find(c => c.key === "marks") ?? primaryCurrency();
  return Number(currencyItem(a, primary)?.system?.quantity) || 0;
}

// ---------------------------------------------------------------------------
//  Portraits
// ---------------------------------------------------------------------------

/**
 * The image to draw for an actor.
 *
 * Token art rather than the actor's key art, because the four small circular
 * avatars (home header, message avatar, contact grid, Student ID) read as a
 * cast list, and a token is framed to be recognisable at 46px in a way a
 * full-body portrait is not.
 *
 * The one place this deliberately does *not* apply is the 96x118 contact detail
 * panel, which uses `actor.img` directly: it is a tall rectangle put through
 * `object-fit: cover`, so a square token gets its sides sliced off and any ring
 * baked into the token art gets cut through. That panel is the one screen where
 * large character art earns its space.
 *
 * `useTokenImages` turns the whole behaviour off without a code change.
 */
export function portraitOf(actor) {
  if (!actor) return null;
  let useToken = true;
  try { useToken = game.settings.get(M, "useTokenImages") !== false; } catch (e) { /* unregistered */ }
  if (useToken) {
    const t = actor.prototypeToken?.texture?.src;
    if (t) return t;
  }
  return actor.img ?? null;
}

/**
 * The actor whose scroll should open.
 *
 * A player gets their assigned character. A GM gets whichever token they have
 * selected, so they can inspect a student's scroll in play.
 */
export function playerActor() {
  if (!game.user.isGM) return game.user.character;
  return canvas.tokens?.controlled?.[0]?.actor ?? game.user.character;
}

/** Portrait from the actor directory, by name. */
export function resolvePortrait(name) {
  return portraitOf(game.actors.getName(name));
}

/** The large key art for a name, ignoring the token-image preference. */
export function resolveKeyArt(name) {
  return game.actors.getName(name)?.img ?? null;
}

/** Portrait override from the contact list, falling back to the actor directory. */
export function findPortrait(name, relationships) {
  const rel = (relationships ?? []).find(r => r.name === name);
  if (rel?.img) return rel.img;
  return resolvePortrait(name);
}

/** Unread inbound messages across every conversation — drives the icon badge. */
export function totalUnread(actor) {
  if (!actor) return 0;
  const social = loadSection(actor, F.social);
  let count = 0;
  for (const c of social.conversations || []) {
    count += (c.messages || []).filter(m => !m.read && !m.sent).length;
  }
  return count;
}

// ---------------------------------------------------------------------------
//  Announcements  (world content, with a per-actor legacy fallback)
// ---------------------------------------------------------------------------

/**
 * The announcements this student should see, minus the ones they've dismissed.
 *
 * World scope is the source of truth (C1). The per-actor fallback exists for
 * exactly one situation: a world upgraded to v1.7 whose GM hasn't logged in yet,
 * so the seeding migration hasn't run. Players would otherwise open the Notices
 * app to an empty board that used to have content in it.
 */
export function announcementsFor(actor) {
  const world = getAnnouncements();
  const sys = loadSection(actor, F.system);

  const source = world.length
    ? world
    : (Array.isArray(sys.announcements) ? sys.announcements : []);

  const dismissed = (sys.dismissedAnnouncements || []).map(String);
  return source
    .map((a, i) => ({ ...a, key: String(a.id ?? i) }))
    .filter(a => !dismissed.includes(a.key));
}

/** How many announcements are still undismissed — drives the Notices badge. */
export function unreadNotices(actor) {
  return actor ? announcementsFor(actor).length : 0;
}

// ---------------------------------------------------------------------------
//  Notification log
// ---------------------------------------------------------------------------

/** Nothing older than this many entries is kept, so the flag can't grow forever. */
const NOTIF_CAP = 40;

/**
 * Record something in the notification centre.
 *
 * Toasts used to vanish with no record, so a player who was away from the table
 * when a message landed had no way to find out. Every toast now also lands here.
 *
 * Written silently: this fires from the socket relay and from the macro API,
 * often while the recipient is mid-sentence in a notes field.
 */
export async function pushNotification(actor, { icon = "fa-bell", title, body = "", app: appId = null }) {
  if (!actor?.isOwner) return;   // can't write another player's flags; the relay does that
  const sys = loadSection(actor, F.system);
  if (!Array.isArray(sys.notifications)) sys.notifications = [];

  sys.notifications.unshift({
    id: notifId(),
    icon: String(icon),
    title: String(title ?? ""),
    body: String(body ?? ""),
    app: appId,
    ts: Date.now(),
    read: false,
  });
  sys.notifications = sys.notifications.slice(0, NOTIF_CAP);

  await saveSection(actor, F.system, sys, { silent: true });
}

/** Every logged notification, newest first. */
export function getNotifications(actor) {
  if (!actor) return [];
  const list = loadSection(actor, F.system).notifications;
  return Array.isArray(list) ? list : [];
}

/** Unseen notifications — the dot on the status bar. */
export function unseenNotifications(actor) {
  return getNotifications(actor).filter(n => !n.read).length;
}

/** Mark the whole log seen. Silent; opening the centre shouldn't repaint it. */
export async function markNotificationsSeen(actor) {
  if (!actor?.isOwner) return;
  const sys = loadSection(actor, F.system);
  if (!Array.isArray(sys.notifications) || !sys.notifications.some(n => !n.read)) return;
  for (const n of sys.notifications) n.read = true;
  await saveSection(actor, F.system, sys, { silent: true });
}

/**
 * Drop one entry from the log.
 *
 * Written silently: dismissing a row should make that row disappear, not tear
 * the whole Alerts list down and rebuild it under the cursor. The caller
 * repaints once it resolves.
 */
export async function dismissNotification(actor, id) {
  if (!actor?.isOwner || !id) return false;
  const sys = loadSection(actor, F.system);
  const list = Array.isArray(sys.notifications) ? sys.notifications : [];
  const next = list.filter(n => n.id !== id);
  if (next.length === list.length) return false;
  sys.notifications = next;
  await saveSection(actor, F.system, sys, { silent: true });
  return true;
}

/** Empty the log. */
export async function clearNotifications(actor) {
  if (!actor?.isOwner) return;
  const sys = loadSection(actor, F.system);
  sys.notifications = [];
  await saveSection(actor, F.system, sys);
}

// ---------------------------------------------------------------------------
//  Ledger  —  what makes the Bank more than a read-out
// ---------------------------------------------------------------------------

/** How many ledger lines are kept per student. */
const LEDGER_CAP = 60;

/** This student's transaction history, newest first. */
export function getLedger(actor) {
  if (!actor) return [];
  const list = loadSection(actor, F.system).ledger;
  return Array.isArray(list) ? list : [];
}

/**
 * Move a balance and write the reason down.
 *
 * The amount lives on an inventory item, so this updates the item and appends a
 * dated line to the ledger. Both halves fail soft: a student with no currency
 * item yet gets one created if the caller can create it, and a student whose
 * item is missing and uncreatable still gets the ledger line, so the GM can see
 * that the grant was attempted.
 *
 * Returns the new balance, or null if nothing could be written.
 */
export async function grantCurrency(actor, key, amount, reason = "") {
  const delta = Number(amount);
  if (!actor?.isOwner || !Number.isFinite(delta) || !delta) return null;

  const cur = currencyList().find(c => c.key === key);
  if (!cur) { console.warn(`${M} | grant: no currency "${key}" configured`); return null; }

  const item = currencyItem(actor, cur);
  const before = Number(item?.system?.quantity) || 0;
  const after = Math.max(0, before + delta);

  if (item) {
    await item.update({ "system.quantity": after });
  } else if (delta > 0 && actor.createEmbeddedDocuments) {
    // No item yet. Create one rather than dropping the grant on the floor —
    // "she has never been paid" and "she cannot be paid" are different problems.
    try {
      await actor.createEmbeddedDocuments("Item", [{
        name: cur.itemName, type: "loot", system: { quantity: after },
      }]);
    } catch (e) {
      console.warn(`${M} | grant: could not create a "${cur.itemName}" item on ${actor.name}`, e);
    }
  }

  const sys = loadSection(actor, F.system);
  if (!Array.isArray(sys.ledger)) sys.ledger = [];
  sys.ledger.unshift({
    id: notifId(),
    currency: cur.key,
    delta,
    balance: after,
    reason: String(reason ?? ""),
    ts: Date.now(),
  });
  sys.ledger = sys.ledger.slice(0, LEDGER_CAP);
  await saveSection(actor, F.system, sys, { silent: true });

  return after;
}

// ---------------------------------------------------------------------------
//  Gallery
// ---------------------------------------------------------------------------

/** How many images are kept per student, newest wins. */
const GALLERY_CAP = 120;

/**
 * One gallery entry, normalised.
 *
 * `id`, `ts` and `from` arrived with v1.9 — sharing needs something to address
 * an image by, the grid needs something to sort on, and a shared image should
 * say who sent it. Everything is optional, so a pre-v1.9 gallery of bare
 * `{src, caption}` rows keeps working and picks up the new fields as it is
 * edited.
 */
export function galleryEntry({ src, caption = "", from = "", ts = null, id = null } = {}) {
  return {
    id: id || uid("img"),
    src: String(src ?? ""),
    caption: String(caption ?? ""),
    from: String(from ?? ""),
    ts: Number(ts) || Date.now(),
  };
}

/** This student's gallery, newest first. Entries without a `ts` keep their order. */
export function getGallery(actor) {
  if (!actor) return [];
  const list = loadSection(actor, F.media).gallery;
  if (!Array.isArray(list)) return [];
  return list
    .map((g, i) => ({ ...g, _i: i }))
    .sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0) || b._i - a._i)
    .map(({ _i, ...g }) => g);
}

/**
 * File an image in a student's gallery.
 *
 * Owner-only, like everything else that writes flags: a player sharing with
 * another player cannot call this for the recipient, which is what the GM relay
 * in socket.mjs is for.
 */
export async function addGalleryImage(actor, entry) {
  if (!actor?.isOwner) return null;
  const row = galleryEntry(entry);
  if (!row.src) return null;

  const media = loadSection(actor, F.media);
  if (!Array.isArray(media.gallery)) media.gallery = [];
  media.gallery.push(row);
  if (media.gallery.length > GALLERY_CAP) media.gallery = media.gallery.slice(-GALLERY_CAP);

  await saveSection(actor, F.media, media);
  return row;
}

/**
 * A student's Gift tree, always shaped correctly.
 *
 * Defended field by field rather than trusted, because this is the one section
 * whose contents are expected to be written from outside the module — a macro,
 * an import, whatever generates the campaign's trees.
 */
export function getGiftTree(actor) {
  const raw = loadSection(actor, F.academic).giftTree ?? {};
  const base = defaultGiftTree();

  // What each unlock created, so a refund can take back exactly those items
  // rather than guessing by name. Defended into shape because it is an object
  // of arrays and one bad write would otherwise poison every later read.
  const granted = {};
  if (raw.granted && typeof raw.granted === "object") {
    for (const [nodeId, ids] of Object.entries(raw.granted)) {
      if (Array.isArray(ids)) granted[String(nodeId)] = ids.map(String);
    }
  }

  return {
    // v1.12: the library trees this student is on, in order. A shared trunk and
    // a personal branch are two entries here that gift.mjs draws as one board.
    trees: Array.isArray(raw.trees) ? raw.trees.map(String) : [],
    unlocked: Array.isArray(raw.unlocked) ? raw.unlocked.map(String) : [],
    points: Number(raw.points) || 0,
    granted,

    // v1.11 and earlier stored the tree body here, on the student who had it.
    // Kept rather than dropped: a tree written against the published shape goes
    // on rendering, folded into the composition as an unnamed local tree, until
    // the migration lifts it into the library.
    tiers: Array.isArray(raw.tiers) && raw.tiers.length ? raw.tiers : base.tiers,
    nodes: Array.isArray(raw.nodes) ? raw.nodes : [],
  };
}

/** Replace a student's whole tree record. Owner-only, like every other flag write. */
export async function setGiftTree(actor, tree) {
  if (!actor?.isOwner) return false;
  const academic = loadSection(actor, F.academic);
  const granted = {};
  if (tree?.granted && typeof tree.granted === "object") {
    for (const [nodeId, ids] of Object.entries(tree.granted)) {
      if (Array.isArray(ids)) granted[String(nodeId)] = ids.map(String);
    }
  }
  academic.giftTree = {
    trees: Array.isArray(tree?.trees) ? tree.trees.map(String) : [],
    unlocked: Array.isArray(tree?.unlocked) ? tree.unlocked.map(String) : [],
    points: Number(tree?.points) || 0,
    granted,
    tiers: Array.isArray(tree?.tiers) ? tree.tiers : defaultGiftTree().tiers,
    nodes: Array.isArray(tree?.nodes) ? tree.nodes : [],
  };
  await saveSection(actor, F.academic, academic);
  return true;
}

/**
 * Put a student on a list of library trees.
 *
 * Order matters only for drawing — the first tree is the one the viewer frames
 * on when a student has taken nothing yet.
 */
export async function assignGiftTrees(actor, ids) {
  if (!actor?.isOwner) return false;
  const rec = getGiftTree(actor);
  rec.trees = (Array.isArray(ids) ? ids : []).map(String).filter(Boolean);
  return setGiftTree(actor, rec);
}

/**
 * Hand a student points to spend.
 *
 * One pool across every tree they are on: choosing to go deep on the trunk
 * instead of racing into their branch is a decision worth letting them make.
 * `points` is what is *left* — what has been spent is derivable from `unlocked`.
 */
export async function grantGiftPoints(actor, amount, reason = "") {
  const delta = Math.round(Number(amount));
  if (!actor?.isOwner || !Number.isFinite(delta) || !delta) return null;

  const rec = getGiftTree(actor);
  rec.points = Math.max(0, rec.points + delta);
  await setGiftTree(actor, rec);

  await pushNotification(actor, {
    icon: "fa-diagram-project",
    title: delta > 0 ? `+${delta} Gift point${delta === 1 ? "" : "s"}` : `${delta} Gift points`,
    body: reason || "",
    app: "gift",
  });
  return rec.points;
}

/*
 * Taking a node lives in gift.mjs from v1.12.
 *
 * It stopped being a flag write the moment a tree could span the library: it
 * needs the composed graph to find the node at all, and it creates real items
 * on the actor. What is left here is the storage underneath it.
 */

/** Every image path anything in the world points at, decoded.
 *
 * This is what the capture sweep subtracts from the folder listing, and it has
 * to be exhaustive or the sweep will call a file an orphan while something is
 * still showing it. A gallery is the obvious source; the two non-obvious ones
 * are **message attachments** — a student can attach a capture to a message and
 * then tidy it out of their own gallery, and the message still renders it — and
 * **map pins**, which can carry a photo of the place.
 *
 * Decoded, because `FilePicker.browse` percent-encodes what it returns and a
 * flag holds whatever was written into it. `a%20b.jpg` and `a b.jpg` are the
 * same file and nothing else will tell you so.
 */
export function referencedImages() {
  const out = new Set();
  const add = v => {
    const s = String(v ?? "").trim();
    if (!s) return;
    try { out.add(decodeURIComponent(s)); } catch (e) { out.add(s); }
  };

  for (const a of game.actors) {
    for (const g of (a.getFlag(M, F.media) ?? {}).gallery ?? []) add(g?.src);

    const social = a.getFlag(M, F.social) ?? {};
    for (const c of social.conversations ?? []) {
      for (const m of c.messages ?? []) add(m?.image);
    }
    for (const r of social.relationships ?? []) add(r?.img);
  }

  for (const m of getMaps()) {
    add(m?.img);
    for (const p of m.pins ?? []) add(p?.img);
  }

  return out;
}

/**
 * Put one image in every student's gallery at once.
 *
 * GM-only, and direct rather than relayed: a GM owns every actor, so there is
 * nobody to ask permission of. Each recipient also gets an alert, because an
 * image appearing in your gallery with no explanation is a bug, not a gift.
 *
 * Returns how many students it reached.
 */
export async function pushImageToAll(src, caption = "", { from = "" } = {}) {
  if (!game.user.isGM) {
    ui.notifications.warn("Only a GM can send an image to everyone.");
    return 0;
  }
  const clean = safeImageSrc(src);
  if (!clean) {
    ui.notifications.warn("That image path cannot be used.");
    return 0;
  }

  // Two users can share a character; the gallery should not get the image twice.
  const targets = new Map();
  for (const u of game.users.filter(u => !u.isGM && u.character)) targets.set(u.character.id, u.character);

  let n = 0;
  for (const actor of targets.values()) {
    const media = loadSection(actor, F.media);
    if (!Array.isArray(media.gallery)) media.gallery = [];
    media.gallery.push(galleryEntry({ src: clean, caption, from }));
    await saveSection(actor, F.media, media);

    await pushNotification(actor, {
      icon: "fa-images",
      title: from || "New image",
      body: caption || "Added to your gallery.",
      app: "gallery",
    });
    n++;
  }

  app.ui?.refresh();
  return n;
}

/** Drop one image. Matches on id, falling back to src for pre-v1.9 rows. */
export async function removeGalleryImage(actor, idOrSrc) {
  if (!actor?.isOwner || !idOrSrc) return false;
  const media = loadSection(actor, F.media);
  const list = Array.isArray(media.gallery) ? media.gallery : [];
  const next = list.filter(g => g.id !== idOrSrc && !(!g.id && g.src === idOrSrc));
  if (next.length === list.length) return false;
  media.gallery = next;
  await saveSection(actor, F.media, media);
  return true;
}

// ---------------------------------------------------------------------------
//  Defaults, one per flag sub-key
// ---------------------------------------------------------------------------

export function defaultProfile() {
  return { studentId: "", year: 1, cohort: "", dormitory: "", status: "", statusPreset: "available" };
}

/**
 * An empty but valid Gift tree.
 *
 * The shape is fixed here and the *content* is deliberately not: a Gift is a
 * starting point that grows into a skill tree, and what is on any student's
 * tree is campaign writing rather than module code. Fill `nodes` from a macro or
 * the Command Center; everything here is only what the renderer will need to be
 * able to rely on.
 *
 *   tiers    ordered rows, drawn top to bottom. `key` is what a node points at.
 *   nodes    { id, tier, name, kind, cost, requires[], description, effect }
 *              kind     "buff" | "freeform" | "milestone" | "capstone"
 *              cost     how many points it takes; 0 for something given
 *              requires node ids that must be unlocked first — the edges
 *              effect   mechanical text, kept apart from the flavour so a sheet
 *                       could read one without the other
 *   unlocked node ids the student has taken
 *   points   what they have to spend
 *
 * See the README for the worked shape. Nothing in the module writes `nodes`
 * yet — the viewer is the next piece of work, and it will read exactly this.
 */
export function defaultGiftTree() {
  return {
    tiers: [
      { key: "root", label: "Awakening" },
      { key: "t1", label: "" },
      { key: "t2", label: "" },
      { key: "t3", label: "" },
    ],
    nodes: [],
    unlocked: [],
    points: 0,
  };
}

export function defaultAcademic() {
  return {
    schedule: [
      { period: "First Bell",  course: "", instructor: "", location: "" },
      { period: "Second Bell", course: "", instructor: "", location: "" },
      { period: "Third Bell",  course: "", instructor: "", location: "" },
      { period: "Fourth Bell", course: "", instructor: "", location: "" },
      { period: "Fifth Bell",  course: "", instructor: "", location: "" },
    ],
    gift: "",
    giftDescription: "",
    giftLevel: 1,
    giftMilestones: [],
    giftTree: defaultGiftTree(),
    nextEvent: "",       // legacy; the calendar is world-scope as of v1.7
    nextEventDays: 0,    // legacy
    notes: "",
  };
}

export function defaultSocial() { return { conversations: [], relationships: [] }; }
export function defaultMedia()  { return { gallery: [] }; }

export function defaultSystem() {
  return { announcements: [], dismissedAnnouncements: [], notifications: [], ledger: [] };
}

/** Per-student device personalisation. */
export function defaultPrefs() {
  return { deviceName: "", accent: "aether", reduceMotion: false };
}

// ---------------------------------------------------------------------------
//  Load / save
// ---------------------------------------------------------------------------

const DEFAULTS = {
  [F.profile]: defaultProfile,
  [F.academic]: defaultAcademic,
  [F.social]: defaultSocial,
  [F.media]: defaultMedia,
  [F.system]: defaultSystem,
  [F.prefs]: defaultPrefs,
};

/**
 * Read one flag section, merged over its defaults.
 *
 * Always returns a deep copy, so callers can mutate the result freely without
 * touching what's stored. Read fresh at save time — never hold onto a section
 * captured during a render, or you'll write stale data back.
 */
export function loadSection(actor, section) {
  if (!actor) return null;

  const stored = actor.getFlag(M, section);
  const def = DEFAULTS[section]?.();
  if (!def) return stored ?? {};
  if (!stored) return JSON.parse(JSON.stringify(def));

  // Merge stored over defaults, so a section gains new keys as the schema grows
  const result = JSON.parse(JSON.stringify(def));
  for (const k of Object.keys(result)) {
    if (stored[k] !== undefined && stored[k] !== null) {
      result[k] = JSON.parse(JSON.stringify(stored[k]));
    }
  }
  return result;
}

/**
 * Write one flag section.
 *
 * @param {object}  opts
 * @param {boolean} opts.silent  Tag the update so our own `updateActor` hook
 *   skips the re-render. Use it for anything that autosaves while the user is
 *   typing (relationship notes, read receipts, student-ID assignment) —
 *   otherwise the save tears down and rebuilds the field being typed into.
 */
export async function saveSection(actor, section, data, { silent = false } = {}) {
  // Nested object notation, never a dot path: Foundry's path parser misreads the
  // hyphen in "zenith-scroll" and the write silently does nothing.
  const clone = JSON.parse(JSON.stringify(data));
  await actor.update({ flags: { [M]: { [section]: clone } } }, { zenithSilent: silent });
}

/** Every section flattened into one object, for rendering. */
export function loadAll(actor) {
  const p = loadSection(actor, F.profile);

  // Assign a student ID on first look, but only if we can actually write to
  // this actor, and quietly so it doesn't trigger a re-render mid-open.
  if (!p.studentId && actor?.isOwner) {
    p.studentId = genId();
    saveSection(actor, F.profile, p, { silent: true })
      .catch(e => console.warn(`${M} | Could not assign student ID to ${actor.name}`, e));
  }

  return {
    ...p,
    ...loadSection(actor, F.academic),
    ...loadSection(actor, F.social),
    ...loadSection(actor, F.media),
    ...loadSection(actor, F.system),
    prefs: loadSection(actor, F.prefs),
  };
}

// ---------------------------------------------------------------------------
//  Migration
// ---------------------------------------------------------------------------

/**
 * Migrate an actor from the pre-split v7 format (one flat `studentData` flag)
 * to the current per-section layout. No-op for anything already migrated.
 */
export async function migrateIfNeeded(actor) {
  const oldData = actor.getFlag(M, "studentData");
  if (!oldData) return;                    // nothing to migrate, or already clean
  if (actor.getFlag(M, F.profile)) return; // already migrated

  console.log(`${M} | Migrating ${actor.name} from v7 format...`);

  const profile = {
    studentId: oldData.studentId || genId(),
    year: oldData.year || 1,
    cohort: oldData.cohort || "",
    dormitory: oldData.dormitory || "",
    status: oldData.status || "",
    statusPreset: "available",
  };

  const academic = {
    schedule: oldData.schedule || defaultAcademic().schedule,
    gift: oldData.gift || "",
    giftDescription: oldData.giftDescription || "",
    giftLevel: oldData.giftLevel || 1,
    giftMilestones: oldData.giftMilestones || [],
    nextEvent: oldData.nextEvent || "",
    nextEventDays: oldData.nextEventDays || 0,
    notes: oldData.notes || "",
  };

  // Fold the old flat, sender-keyed message array into conversation objects
  const conversations = [];
  const oldMsgs = oldData.messages || [];
  const threads = {};
  for (const m of oldMsgs) {
    if (m.broadcast) continue;
    const threadName = m._replyTo || m.sender || "Unknown";
    if (threadName.startsWith("[")) continue;
    if (!threads[threadName]) threads[threadName] = [];
    threads[threadName].push({
      from: m._replyTo ? actor.name : m.sender,
      text: m.text || "",
      time: m.time || "",
      image: m.image || "",
      read: m.read ?? true,
      sent: !!m._replyTo,
    });
  }
  for (const [name, msgs] of Object.entries(threads)) {
    conversations.push({
      id: convId(),
      participants: [actor.name, name],
      title: null,
      isGroup: false,
      messages: msgs,
      muted: false,
    });
  }

  const social = { conversations, relationships: oldData.relationships || [] };
  const media = { gallery: oldData.gallery || [] };
  const system = {
    announcements: oldData.announcements || [],
    dismissedAnnouncements: oldData.dismissedBroadcasts || [],
    notifications: [],
  };

  await saveSection(actor, F.profile, profile);
  await saveSection(actor, F.academic, academic);
  await saveSection(actor, F.social, social);
  await saveSection(actor, F.media, media);
  await saveSection(actor, F.system, system);

  try { await actor.unsetFlag(M, "studentData"); } catch (e) { /* already gone */ }
  console.log(`${M} | Migration complete for ${actor.name}`);
}

// ---------------------------------------------------------------------------
//  C4 — backfill message sort timestamps
// ---------------------------------------------------------------------------

/**
 * Stamp a `ts` onto messages written before v1.6.
 *
 * Those messages sort by reverse creation order, which is right often enough to
 * be invisible and wrong often enough to be annoying. There is no real time to
 * recover, so this infers one: walk each thread oldest-to-newest and lay the
 * messages out a minute apart, ending an hour before the thread's first real
 * timestamp (or before now, for a thread with no stamped messages at all).
 *
 * That ordering is a guess, but it is the same guess the display already makes,
 * made durable — and it means the *thread list* now sorts sensibly, which is
 * what actually bothered anyone.
 */
export async function backfillTimestamps(actor) {
  if (!actor?.isOwner) return false;

  const social = loadSection(actor, F.social);
  let touched = false;

  for (const conv of social.conversations || []) {
    const msgs = conv.messages || [];
    if (!msgs.length || msgs.every(m => Number(m.ts))) continue;

    const firstReal = msgs.find(m => Number(m.ts))?.ts;
    const anchor = (Number(firstReal) || Date.now()) - 3600_000;

    msgs.forEach((m, i) => {
      if (Number(m.ts)) return;
      m.ts = anchor - (msgs.length - i) * 60_000;
      touched = true;
    });
  }

  if (touched) await saveSection(actor, F.social, social, { silent: true });
  return touched;
}

// ---------------------------------------------------------------------------
//  Danger Zone  —  export and clear
// ---------------------------------------------------------------------------

/** The flag sections `clearScrollData` removes and `exportScrollData` captures. */
export const SCROLL_SECTIONS = [F.profile, F.academic, F.social, F.media, F.system, F.prefs];

/**
 * Everything the module stores, as a plain object ready to be written to JSON.
 *
 * This is the only real undo for a clear, which is why the Danger Zone offers it
 * first and defaults to taking it. Raw stored flags rather than `loadAll()`
 * output: a backup should record what is actually there, not what the defaults
 * would have filled in.
 */
export function exportScrollData({ includeWorld = true } = {}) {
  const actors = [];
  for (const a of game.actors) {
    const flags = {};
    let any = false;
    for (const sec of SCROLL_SECTIONS) {
      const v = a.getFlag(M, sec);
      if (v !== undefined && v !== null) { flags[sec] = JSON.parse(JSON.stringify(v)); any = true; }
    }
    const legacy = a.getFlag(M, "studentData");
    if (legacy) { flags.studentData = JSON.parse(JSON.stringify(legacy)); any = true; }
    if (any) actors.push({ id: a.id, name: a.name, flags });
  }

  const out = {
    module: M,
    exportedAt: new Date().toISOString(),
    world: game.world?.id ?? null,
    actorCount: actors.length,
    actors,
  };

  if (includeWorld) {
    let announcements = [], events = [];
    try { announcements = game.settings.get(M, "worldAnnouncements") ?? []; } catch (e) { /* unregistered */ }
    try { events = game.settings.get(M, "worldEvents") ?? []; } catch (e) { /* unregistered */ }
    out.worldContent = { announcements, events };
  }

  return out;
}

/**
 * How many actors a clear would actually touch, and how much is on them.
 *
 * The confirmation dialog says this out loud before anything is removed, because
 * "clear all scroll data" means nothing until you know it is 14 actors and 300
 * messages.
 */
export function scrollDataSummary() {
  let actors = 0, messages = 0, contacts = 0, images = 0, notifications = 0;
  for (const a of game.actors) {
    const has = SCROLL_SECTIONS.some(sec => a.getFlag(M, sec) !== undefined) || !!a.getFlag(M, "studentData");
    if (!has) continue;
    actors++;
    const social = a.getFlag(M, F.social) ?? {};
    for (const c of social.conversations ?? []) messages += (c.messages ?? []).length;
    contacts += (social.relationships ?? []).length;
    images += ((a.getFlag(M, F.media) ?? {}).gallery ?? []).length;
    notifications += ((a.getFlag(M, F.system) ?? {}).notifications ?? []).length;
  }
  return { actors, messages, contacts, images, notifications };
}

/**
 * Remove every per-actor flag the module writes.
 *
 * Flags are *unset* rather than overwritten with empty objects, so the actors
 * come back genuinely clean rather than carrying an empty shell of the schema.
 *
 * World notices and the calendar are opt-in (`includeWorld`, default off): they
 * are the school's content rather than anything a scroll holds, and wanting a
 * student's messages gone is not the same as wanting the notice board gone.
 */
export async function clearScrollData({ includeWorld = false } = {}) {
  let cleared = 0;
  for (const a of game.actors) {
    let touched = false;
    for (const sec of [...SCROLL_SECTIONS, "studentData"]) {
      if (a.getFlag(M, sec) === undefined) continue;
      try { await a.unsetFlag(M, sec); touched = true; }
      catch (e) { console.warn(`${M} | could not clear ${sec} on ${a.name}`, e); }
    }
    if (touched) cleared++;
  }

  if (includeWorld && game.user.isGM) {
    try {
      await game.settings.set(M, "worldAnnouncements", []);
      await game.settings.set(M, "worldEvents", []);
    } catch (e) { console.warn(`${M} | could not clear world content`, e); }
  }

  return cleared;
}

/**
 * Re-read every stored contact portrait from the actor directory.
 *
 * The two "add as contact" paths *store* the image on the relationship record,
 * so contacts added before v1.8 keep whatever art was current when they were
 * added — flipping `useTokenImages` does not reach them. This is the migration
 * that does.
 *
 * Only entries that resolve to a real actor are touched; a hand-typed portrait
 * path for an NPC with no actor is left exactly as it is.
 */
export async function refreshPortraits() {
  let changed = 0;
  for (const a of game.actors) {
    if (!a.isOwner) continue;
    if (a.getFlag(M, F.social) === undefined) continue;

    const social = loadSection(a, F.social);
    let touched = false;
    for (const r of social.relationships ?? []) {
      const want = resolvePortrait(r.name);
      if (want && r.img !== want) { r.img = want; touched = true; }
    }
    if (touched) { await saveSection(a, F.social, social, { silent: true }); changed++; }
  }
  return changed;
}
