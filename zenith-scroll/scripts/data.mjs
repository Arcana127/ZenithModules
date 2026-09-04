/**
 * Zenith Academy Scroll — data layer
 *
 * Everything that reads or writes actor flags, plus the derived reads the UI
 * needs (marks, portraits, unread counts).
 *
 * The one rule that matters here: saves use nested object notation
 * (`{flags: {[M]: {[section]: data}}}`), never a dot-path like
 * `flags.zenith-scroll.academic`. Foundry's path parser misreads the hyphen in
 * the module id and the write silently fails.
 */

import { M, F, genId, convId } from "./core.mjs";

// ---------------------------------------------------------------------------
//  Derived reads
// ---------------------------------------------------------------------------

/** Marks are an inventory item on the actor, not a flag. */
export function getMarks(a) {
  if (!a) return 0;
  const i = a.items.find(x => x.name?.toLowerCase() === "marks");
  return i?.system?.quantity ?? 0;
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
  const actor = game.actors.getName(name);
  if (actor?.img) return actor.img;
  return null;
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
//  Defaults, one per flag sub-key
// ---------------------------------------------------------------------------

export function defaultProfile() {
  return { studentId: "", year: 1, cohort: "", dormitory: "", status: "", statusPreset: "available" };
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
    nextEvent: "",
    nextEventDays: 0,
    notes: "",
  };
}

export function defaultSocial() { return { conversations: [], relationships: [] }; }
export function defaultMedia()  { return { gallery: [] }; }
export function defaultSystem() { return { announcements: [], dismissedAnnouncements: [] }; }

// ---------------------------------------------------------------------------
//  Load / save
// ---------------------------------------------------------------------------

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
  const defaults = {
    [F.profile]: defaultProfile,
    [F.academic]: defaultAcademic,
    [F.social]: defaultSocial,
    [F.media]: defaultMedia,
    [F.system]: defaultSystem,
  };

  const def = defaults[section]?.();
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
  };

  await saveSection(actor, F.profile, profile);
  await saveSection(actor, F.academic, academic);
  await saveSection(actor, F.social, social);
  await saveSection(actor, F.media, media);
  await saveSection(actor, F.system, system);

  try { await actor.unsetFlag(M, "studentData"); } catch (e) { /* already gone */ }
  console.log(`${M} | Migration complete for ${actor.name}`);
}
