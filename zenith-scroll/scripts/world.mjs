/**
 * Zenith Academy Scroll — world content
 *
 * Announcements and calendar events belong to the school, not to any one
 * student. Before v1.7 they lived in every actor's flags and were pushed out by
 * "copy to all" buttons, which meant editing an announcement left every player
 * holding a stale copy until the GM remembered to push again. They now live in
 * world settings, written once and read by everyone.
 *
 * What stays per-actor is what is genuinely personal: which announcements *I*
 * have dismissed, my messages, my notes, my relationship ranks, my gallery.
 *
 * Only a GM can write a world setting, which is exactly right here — all of
 * this content is GM-authored. Players only ever read it.
 *
 * Imports core only, so the dependency direction stays core <- world <- data.
 */

import { M, annId, evtId, uid, safeImageSrc } from "./core.mjs";

/** World setting keys. */
export const WS = {
  announcements: "worldAnnouncements",
  events: "worldEvents",
  maps: "worldMaps",              // v1.11
  queued: "worldQueuedMessages",  // v1.11
  giftTrees: "worldGiftTrees",    // v1.12
  seeded: "worldContentSeeded",   // C1 migration marker
  schemaVersion: "schemaVersion", // C6
};

/** The schema this build writes. Bumped when a migration is added. */
export const SCHEMA_VERSION = 3;

// ---------------------------------------------------------------------------
//  Reads
// ---------------------------------------------------------------------------

/**
 * A world setting, defended against being read before registration.
 *
 * `ready` runs our seeding, but a macro or another module's hook can call in
 * earlier than that, and an unregistered-setting throw at that point would take
 * down whatever called us.
 */
function read(key, fallback) {
  try {
    const v = game.settings.get(M, key);
    return v ?? fallback;
  } catch (e) {
    return fallback;
  }
}

/** Every school announcement, newest first as authored by the GM. */
export function getAnnouncements() {
  const list = read(WS.announcements, []);
  return Array.isArray(list) ? list : [];
}

/** Every scheduled school event. */
export function getEvents() {
  const list = read(WS.events, []);
  return Array.isArray(list) ? list : [];
}

/**
 * The event to count down to on the lock screen and Student ID app.
 *
 * Soonest first, and anything already past is skipped — an event list is a
 * calendar, and a calendar that keeps showing last month's exam is worse than
 * one showing nothing.
 */
export function nextEvent() {
  const upcoming = getEvents()
    .filter(e => e.name && (Number(e.days) ?? 0) >= 0)
    .sort((a, b) => (Number(a.days) || 0) - (Number(b.days) || 0));
  return upcoming[0] ?? null;
}

/** Stored schema version, 0 for a world that predates the marker. */
export function schemaVersion() {
  return Number(read(WS.schemaVersion, 0)) || 0;
}

/** Stamp the schema version a migration has just brought the world up to. */
export async function setSchemaVersion(n) {
  if (!game.user.isGM) return;
  await game.settings.set(M, WS.schemaVersion, Number(n) || 0);
}

// ---------------------------------------------------------------------------
//  Writes  (GM only — Foundry refuses a world-setting write from a player)
// ---------------------------------------------------------------------------

export async function setAnnouncements(list) {
  if (!game.user.isGM) return;
  const clean = (list || [])
    .filter(a => a && String(a.text ?? "").trim())
    .map(a => ({
      id: a.id || annId(),
      text: String(a.text),
      time: String(a.time ?? ""),
      pinned: !!a.pinned,
      ts: Number(a.ts) || Date.now(),
    }));
  await game.settings.set(M, WS.announcements, clean);
}

export async function setEvents(list) {
  if (!game.user.isGM) return;
  const clean = (list || [])
    .filter(e => e && String(e.name ?? "").trim())
    .map(e => ({
      id: e.id || evtId(),
      name: String(e.name),
      days: Number(e.days) || 0,
      detail: String(e.detail ?? ""),
    }));
  await game.settings.set(M, WS.events, clean);
}

// ---------------------------------------------------------------------------
//  C1 migration
// ---------------------------------------------------------------------------

/**
 * Lift announcements and the next event out of actor flags into world settings,
 * once, the first time a GM loads a world that predates the split.
 *
 * The old data is deliberately left on the actors rather than deleted. It costs
 * a few hundred bytes, and it means that if this seeding picks the wrong actor
 * to harvest from, the original is still there to look at.
 *
 * Harvesting takes the *richest* student rather than the first: with "copy to
 * all" every student normally holds the same list, but a student added to the
 * game after the last push holds an empty one, and picking that one would throw
 * the whole board away.
 */
export async function seedWorldContent() {
  if (!game.user.isGM) return;
  if (read(WS.seeded, false)) return;

  const students = game.users.filter(u => !u.isGM && u.character).map(u => u.character);

  // --- announcements: take the longest surviving list ---
  let bestAnns = [];
  for (const a of students) {
    const sys = a.getFlag(M, "system");
    const list = Array.isArray(sys?.announcements) ? sys.announcements : [];
    if (list.length > bestAnns.length) bestAnns = list;
  }
  if (bestAnns.length && !getAnnouncements().length) {
    await setAnnouncements(bestAnns.map(x => ({ ...x, id: x.id || annId() })));
    console.log(`${M} | C1: lifted ${bestAnns.length} announcement(s) to world scope`);
  }

  // --- events: the old model held exactly one, on academic.nextEvent ---
  if (!getEvents().length) {
    const seen = new Map();
    for (const a of students) {
      const ac = a.getFlag(M, "academic");
      if (!ac?.nextEvent) continue;
      const key = `${ac.nextEvent}::${ac.nextEventDays ?? 0}`;
      seen.set(key, { name: ac.nextEvent, days: Number(ac.nextEventDays) || 0 });
    }
    if (seen.size) {
      await setEvents([...seen.values()]);
      console.log(`${M} | C1: lifted ${seen.size} event(s) to world scope`);
    }
  }

  await game.settings.set(M, WS.seeded, true);
  await game.settings.set(M, WS.schemaVersion, SCHEMA_VERSION);
}

// ---------------------------------------------------------------------------
//  Maps
// ---------------------------------------------------------------------------

/**
 * Every map the school knows about.
 *
 * World content for the same reason the notice board is: one map, read by
 * everyone, edited once. A pin's position is a percentage of the image rather
 * than a pixel, so the same map reads correctly on a 480px panel and in the
 * lightbox without anyone recomputing anything.
 *
 * `found` is the interesting field. A pin the party has not found yet is stored
 * but not sent to the app, which is how a map can be handed out at session one
 * and still have somewhere to go in session nine.
 */
export function getMaps() {
  const list = read(WS.maps, []);
  return Array.isArray(list) ? list : [];
}

/** The maps a student should actually see, with undiscovered pins stripped. */
export function visibleMaps() {
  return getMaps()
    .filter(m => m.published !== false)
    .map(m => ({ ...m, pins: (m.pins ?? []).filter(p => p.found !== false) }));
}

export async function setMaps(list) {
  if (!game.user.isGM) return;
  const clean = (list || [])
    .filter(m => m && String(m.name ?? "").trim())
    .map(m => ({
      id: m.id || uid("map"),
      name: String(m.name),
      img: safeImageSrc(m.img),
      note: String(m.note ?? ""),
      published: m.published !== false,
      pins: (m.pins || [])
        .filter(p => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)))
        .map(p => ({
          id: p.id || uid("pin"),
          // Clamped, because a pin dragged off the edge of the editor preview
          // would otherwise be stored somewhere no student can ever tap it.
          x: Math.min(100, Math.max(0, Number(p.x))),
          y: Math.min(100, Math.max(0, Number(p.y))),
          label: String(p.label ?? ""),
          note: String(p.note ?? ""),
          icon: String(p.icon || "fa-location-dot"),
          img: safeImageSrc(p.img),
          found: p.found !== false,
        })),
    }));
  await game.settings.set(M, WS.maps, clean);
}

// ---------------------------------------------------------------------------
//  Queued messages
// ---------------------------------------------------------------------------

/**
 * Messages written in advance and sent by hand.
 *
 * Deliberately *not* scheduled against the world clock. A GM who has written
 * the session's beats wants them to land on the beat, not at a timestamp
 * guessed the night before — so these sit here until a button is pressed, and
 * stay afterwards, because the good ones get used again.
 */
export function getQueued() {
  const list = read(WS.queued, []);
  return Array.isArray(list) ? list : [];
}

export async function setQueued(list) {
  if (!game.user.isGM) return;
  const clean = (list || [])
    .filter(q => q && String(q.text ?? "").trim())
    .map(q => ({
      id: q.id || uid("q"),
      label: String(q.label ?? ""),
      from: String(q.from ?? ""),
      text: String(q.text),
      image: safeImageSrc(q.image),
      // "all" or a list of actor ids. Stored as written so a student joining
      // later is included by a queue entry that says everyone.
      to: q.to === "all" ? "all" : (Array.isArray(q.to) ? q.to.map(String) : "all"),
      lastSent: Number(q.lastSent) || 0,
      sentCount: Number(q.sentCount) || 0,
    }));
  await game.settings.set(M, WS.queued, clean);
}

/** Record that a queue entry went out, without disturbing the rest of it. */
export async function markQueuedSent(id) {
  if (!game.user.isGM) return;
  const list = getQueued().map(q =>
    q.id === id ? { ...q, lastSent: Date.now(), sentCount: (Number(q.sentCount) || 0) + 1 } : q);
  await game.settings.set(M, WS.queued, list);
}

// ---------------------------------------------------------------------------
//  Gift trees
// ---------------------------------------------------------------------------

/**
 * The library of Gift trees.
 *
 * World content, for the reason the notice board is: before v1.12 a tree lived
 * on the student who had it, so one shared tree existed as six independent
 * copies and fixing a typo was six writes — each of which had to carefully
 * preserve what that student had already spent. The tree *body* lives here now;
 * what stays on the actor is only what is personal to them, which is the nodes
 * they have taken and the points they have left.
 *
 * A student is assigned a *list* of these, not one, which is what lets a shared
 * trunk and a personal branch be two trees that draw as one. See gift.mjs for
 * the composition.
 */
export const GIFT_KINDS = ["buff", "freeform", "milestone", "capstone"];

/** Every tree in the library. */
export function getGiftTrees() {
  const list = read(WS.giftTrees, []);
  return Array.isArray(list) ? list : [];
}

/** One tree by id, or null. */
export function giftTreeById(id) {
  if (!id) return null;
  return getGiftTrees().find(t => String(t.id) === String(id)) ?? null;
}

/**
 * One node, defended field by field.
 *
 * Shared with the editor, which builds nodes from form values, and with the
 * importer a GM's macro effectively is. `x`/`y` are a percentage of the board
 * rather than a pixel — the decision map pins made in v1.11, for the same
 * reason: the board is 480px wide on the device and far wider in the editor,
 * and a percentage lands correctly in both with nothing to recompute.
 */
export function cleanGiftNode(n) {
  return {
    // A colon would break the namespacing gift.mjs builds ids with, exactly as
    // it would in a tree id.
    id: String(n?.id || uid("gn")).replace(/:/g, "-"),
    name: String(n?.name ?? ""),
    kind: GIFT_KINDS.includes(n?.kind) ? n.kind : "buff",
    cost: Math.max(0, Math.round(Number(n?.cost) || 0)),
    requires: Array.isArray(n?.requires) ? n.requires.map(String).filter(Boolean) : [],
    description: String(n?.description ?? ""),
    effect: String(n?.effect ?? ""),
    // Clamped, because a node dragged off the edge of the editor board would
    // otherwise be stored somewhere no student can ever pan to.
    x: Math.min(100, Math.max(0, Number(n?.x) || 0)),
    y: Math.min(100, Math.max(0, Number(n?.y) || 0)),
    // A label and a filter, never a position — v1.11 drew rows from this, and
    // free placement replaced that in v1.12. The field stays because the README
    // published it.
    tier: String(n?.tier ?? ""),
    icon: String(n?.icon || ""),
    // Reserved: every requires list means ALL of them until something wants
    // otherwise. Stored so a tree authored against it survives a build that
    // implements it.
    requiresAny: n?.requiresAny === true,
    grants: Array.isArray(n?.grants)
      ? n.grants
          .filter(g => g && String(g.uuid ?? "").trim())
          .map(g => ({
            uuid: String(g.uuid),
            // Cached so the inspector and the student's detail sheet can name a
            // grant without the pack being open — and so a UUID that has gone
            // dead still says *what* has gone missing.
            name: String(g.name ?? ""),
            img: safeImageSrc(g.img),
          }))
      : [],
  };
}

/** Replace the whole library. GM-only, like every other world write. */
export async function setGiftTrees(list) {
  if (!game.user.isGM) return;
  const clean = (list || [])
    .filter(t => t && String(t.id ?? "").trim())
    .map(t => ({
      // A colon would break the namespacing gift.mjs does with it, and a
      // leading tilde is reserved for the pseudo-tree a pre-v1.12 actor-local
      // tree composes as.
      id: String(t.id).replace(/:/g, "-").replace(/^~+/, ""),
      name: String(t.name ?? "") || String(t.id),
      note: String(t.note ?? ""),
      nodes: Array.isArray(t.nodes) ? t.nodes.map(cleanGiftNode) : [],
    }));
  await game.settings.set(M, WS.giftTrees, clean);
}

/** Write one tree back without disturbing the rest of the library. */
export async function saveGiftTree(tree) {
  if (!game.user.isGM || !tree?.id) return;
  const list = getGiftTrees();
  const i = list.findIndex(t => String(t.id) === String(tree.id));
  if (i >= 0) list[i] = tree;
  else list.push(tree);
  await setGiftTrees(list);
}

/** Drop a tree from the library. Students assigned to it simply stop seeing it. */
export async function deleteGiftTree(id) {
  if (!game.user.isGM) return;
  await setGiftTrees(getGiftTrees().filter(t => String(t.id) !== String(id)));
}
