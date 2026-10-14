/**
 * Zenith Academy Scroll — macro API
 *
 * Exposed as `game.modules.get("zenith-scroll").api` for use from macros and
 * journal script buttons, e.g.
 *
 *   const zs = game.modules.get("zenith-scroll").api;
 *   await zs.sendNPCMessage("Rin Adler", "Prof. Hale", "See me after class.");
 *   await zs.adjustRelationship("Rin Adler", "Prof. Hale", +1, "Covered for her");
 *   await zs.postNotice("Duelling hall closed for repairs.");
 *   await zs.setSchoolEvent("Second Examination", 3);
 *   await zs.grant("Rin Adler", "astras", 50, "Tournament prize");
 *   zs.recentreScroll();
 *
 * Actor-scoped methods take an actor name or id and write flags directly, so
 * they must be run by a GM (or by whoever owns the target actor). The
 * world-scoped ones (notices, events) are GM-only, because Foundry will not let
 * a player write a world setting.
 */

import { F, convId, evtId, getAutoTime, relInfo, app, currencyList, currencyInfo } from "./core.mjs";
import {
  loadSection, saveSection, pushNotification, grantCurrency, getBalances,
  getLedger, exportScrollData, refreshPortraits, galleryEntry, getGallery,
  pushImageToAll, getGiftTree, setGiftTree, defaultGiftTree,
  assignGiftTrees, grantGiftPoints,
} from "./data.mjs";
import {
  unlockGiftNode, refundGiftNode, resetGiftTree, resolveGiftTree,
  validateGiftTree, deadGrants, newGiftTree,
} from "./gift.mjs";
import {
  notebookFor, partyNotebook, provisionNotebooks, notebookMarkdown, allNotesMarkdown,
} from "./notes.mjs";
import { sweepCaptures } from "./sweep.mjs";
import { findOrphanCaptures } from "./capture.mjs";
import {
  getAnnouncements, setAnnouncements, getEvents, setEvents,
  getQueued, setQueued, markQueuedSent, getMaps, setMaps,
  getGiftTrees, giftTreeById, saveGiftTree, deleteGiftTree,
} from "./world.mjs";
import { emitDelivered } from "./socket.mjs";

/** Resolve an actor from either an id or a name. */
function resolveActor(actorNameOrId) {
  return game.actors.get(actorNameOrId) ?? game.actors.getName(actorNameOrId);
}

/** Every player character in the world, as actors. */
function studentActors() {
  return game.users.filter(u => !u.isGM && u.character).map(u => u.character);
}

export class ZenithAPI {

  // -------------------------------------------------------------------------
  //  Messages
  // -------------------------------------------------------------------------

  /**
   * Deliver a message from an NPC into a student's scroll.
   * `time` is the display string; leave it blank for the current world time.
   */
  static async sendNPCMessage(actorNameOrId, npcName, text, time = "", image = "") {
    const a = resolveActor(actorNameOrId);
    if (!a) return ui.notifications.error("Actor not found.");

    const social = loadSection(a, F.social);
    let conv = social.conversations.find(c => !c.isGroup && c.participants.includes(npcName));
    if (!conv) {
      conv = {
        id: convId(), participants: [a.name, npcName],
        title: null, isGroup: false, messages: [], muted: false,
      };
      social.conversations.push(conv);
    }

    conv.messages.push({
      from: npcName, text,
      time: time || getAutoTime() || "", ts: Date.now(),
      image, read: false, sent: false,
    });

    await saveSection(a, F.social, social);

    // A muted thread still lands in the notification centre; muting silences
    // the pulse and the toast, not the record.
    await pushNotification(a, {
      icon: "fa-comment-dots", title: npcName,
      body: String(text ?? "").slice(0, 90), app: "messages",
    });

    if (!conv.muted) app.icon?.pulse();
    app.icon?.updateBadge(a);
    app.ui?.refresh();
  }

  /** Same, to every student at once. */
  static async sendNPCMessageAll(npcName, text, time = "", image = "") {
    for (const a of studentActors()) {
      await ZenithAPI.sendNPCMessage(a.id, npcName, text, time, image);
    }
  }

  // -------------------------------------------------------------------------
  //  Relationships
  // -------------------------------------------------------------------------

  /**
   * Nudge a relationship rank, clamped to the -5..+5 scale.
   * Passing a `reason` appends a line to that contact's history log.
   */
  static async adjustRelationship(actorNameOrId, npcName, delta = 1, reason = "") {
    const a = resolveActor(actorNameOrId);
    if (!a) return;

    const social = loadSection(a, F.social);
    const r = social.relationships.find(x => x.name === npcName);
    if (!r) return;

    const oldRank = r.rank ?? 0;
    r.rank = Math.max(-5, Math.min(5, oldRank + delta));
    if (!r.history) r.history = [];
    if (reason) r.history.push(`${relInfo(oldRank).label} → ${relInfo(r.rank).label}: ${reason}`);

    await saveSection(a, F.social, social);

    if (r.rank !== oldRank) {
      await pushNotification(a, {
        icon: delta > 0 ? "fa-heart" : "fa-heart-crack",
        title: `${npcName}: ${relInfo(r.rank).label}`,
        body: reason || `Your bond ${delta > 0 ? "deepened" : "cooled"}.`,
        app: "contacts",
      });
    }
    app.ui?.refresh();
  }

  // -------------------------------------------------------------------------
  //  Bank
  // -------------------------------------------------------------------------

  /**
   * Move a student's balance and write down why.
   *
   * This is the thing that makes the Bank app more than a read-out: it changes
   * the inventory item's quantity, appends a dated line to that student's
   * ledger, and raises an alert. A negative amount is a charge.
   *
   *   await zs.grant("Rin Adler", "astras", 50, "Tournament prize");
   *   await zs.grant("Rin Adler", "marks", -12, "Replacement wand");
   */
  static async grant(actorNameOrId, key, amount, reason = "") {
    const a = resolveActor(actorNameOrId);
    if (!a) return ui.notifications.error("Actor not found.");

    const cur = currencyInfo(key);
    if (!cur) {
      return ui.notifications.error(
        `No currency "${key}". Configured: ${currencyList().map(c => c.key).join(", ")}`);
    }

    const balance = await grantCurrency(a, key, amount, reason);
    if (balance === null) return null;

    const delta = Number(amount);
    await pushNotification(a, {
      icon: cur.icon,
      title: `${delta > 0 ? "+" : "−"}${Math.abs(delta)} ${cur.label}`,
      body: reason || (delta > 0 ? "Credited to your account." : "Debited from your account."),
      app: "bank",
    });

    app.icon?.pulse();
    app.ui?.refresh();
    return balance;
  }

  /** Same, to every student at once. */
  static async grantAll(key, amount, reason = "") {
    for (const a of studentActors()) await ZenithAPI.grant(a.id, key, amount, reason);
  }

  /** Read a student's balances without changing them. */
  static balances(actorNameOrId) {
    const a = resolveActor(actorNameOrId);
    return a ? getBalances(a) : [];
  }

  /** Read a student's transaction history, newest first. */
  static ledger(actorNameOrId) {
    const a = resolveActor(actorNameOrId);
    return a ? getLedger(a) : [];
  }

  // -------------------------------------------------------------------------
  //  Maintenance
  // -------------------------------------------------------------------------

  /**
   * Put the caller's bracelet back in the middle of their screen.
   *
   * Per-user, like the position it resets — a GM running this moves their own
   * bracelet, not everyone's. The module settings sheet and Shift+G reach the
   * same code; this is here for a macro on the hotbar.
   */
  static recentreScroll() {
    if (app.icon?.centre()) return true;
    ui.notifications.warn("The scroll is not on screen yet.");
    return false;
  }

  /**
   * Re-read every stored contact portrait from the actor directory.
   *
   * Contacts added before v1.8 stored whatever art was current when they were
   * added, so flipping `useTokenImages` does not reach them. This is how you
   * bring them up to date.
   */
  static async refreshPortraits() {
    const n = await refreshPortraits();
    ui.notifications.info(`Portraits refreshed on ${n} actor${n === 1 ? "" : "s"}.`);
    app.ui?.refresh();
    return n;
  }

  /**
   * Everything the module stores, as a plain object.
   *
   * The Command Center's Danger Zone offers this as a file download; this is the
   * same data for a macro that wants to do something else with it.
   */
  static exportData(opts = {}) {
    if (!game.user.isGM) return ui.notifications.warn("Only a GM can export scroll data.");
    return exportScrollData(opts);
  }

  // -------------------------------------------------------------------------
  //  Gallery
  // -------------------------------------------------------------------------

  static async addGalleryImage(actorNameOrId, src, caption = "", { from = "" } = {}) {
    const a = resolveActor(actorNameOrId);
    if (!a) return;

    const media = loadSection(a, F.media);
    if (!Array.isArray(media.gallery)) media.gallery = [];
    media.gallery.push(galleryEntry({ src, caption, from }));

    await saveSection(a, F.media, media);
    await pushNotification(a, {
      icon: "fa-images", title: from || "New image",
      body: caption || "Added to your gallery.", app: "gallery",
    });
    app.icon?.pulse();
    app.ui?.refresh();
  }

  /**
   * The same image into every student's gallery at once.
   *
   * GM-only. This is the one you want after a session: the party photo, the map
   * of the tomb, the letter they found. Everyone gets an alert as well, so it
   * isn't a silent change to their device.
   */
  static async addGalleryImageAll(src, caption = "", { from = "" } = {}) {
    return pushImageToAll(src, caption, { from });
  }

  /** What is in a student's gallery, newest first. */
  static gallery(actorNameOrId) {
    const a = resolveActor(actorNameOrId);
    return a ? getGallery(a) : [];
  }

  // -------------------------------------------------------------------------
  //  Notes
  // -------------------------------------------------------------------------

  /**
   * A student's notebook, as the JournalEntry it actually is.
   *
   * Handed back whole rather than wrapped, because everything you would want to
   * do with it — render it, add a page, set ownership — is a thing a
   * JournalEntry already does better than a shim would.
   */
  static notebook(actorNameOrId) {
    const a = resolveActor(actorNameOrId);
    return a ? notebookFor(a) : null;
  }

  /** The one shared notebook, as the JournalEntry it is. */
  static partyNotebook() {
    return partyNotebook();
  }

  /**
   * A notebook as Markdown, for pasting somewhere that is not Foundry.
   *
   * `book` is "personal", "party", or "all" for both with a rule between them.
   */
  static notesMarkdown(actorNameOrId, book = "personal") {
    const a = resolveActor(actorNameOrId);
    if (!a) return "";
    return book === "all" ? allNotesMarkdown(a) : notebookMarkdown(a, book);
  }

  // -------------------------------------------------------------------------
  //  Gift trees
  // -------------------------------------------------------------------------

  /*
   * The tree's *shape* is fixed by the module; its contents are campaign
   * writing. These four are the whole surface a generator needs: read the empty
   * shape, write a filled one, read it back, and take a node.
   */

  /** The empty-but-valid shape, to build a tree against. */
  static giftTreeTemplate() {
    return defaultGiftTree();
  }

  /** A student's tree, defended into the right shape whatever is stored. */
  static giftTree(actorNameOrId) {
    const a = resolveActor(actorNameOrId);
    return a ? getGiftTree(a) : null;
  }

  /** Replace a student's whole tree. */
  static async setGiftTree(actorNameOrId, tree) {
    const a = resolveActor(actorNameOrId);
    if (!a) return ui.notifications.error("Actor not found."), false;
    const done = await setGiftTree(a, tree);
    if (done) app.ui?.refresh();
    return done;
  }

  /**
   * Take a node. `{force: true}` grants it regardless of cost or requirements.
   *
   * `unlockGiftNode` raises the alert itself from v1.12 — it is the same event
   * whether a student tapped it or a macro did, and two notifications for one
   * unlock was the alternative.
   */
  static async unlockGift(actorNameOrId, nodeId, opts = {}) {
    const a = resolveActor(actorNameOrId);
    if (!a) return { ok: false, why: "actor not found" };
    const res = await unlockGiftNode(a, nodeId, opts);
    if (res.ok) app.icon?.pulse();
    return res;
  }

  // -------------------------------------------------------------------------
  //  Gift trees — the library
  // -------------------------------------------------------------------------

  /** Every tree in the world library. */
  static giftTrees() {
    return getGiftTrees();
  }

  /** One tree by id. */
  static giftTreeNamed(id) {
    return giftTreeById(id);
  }

  /** An empty tree, with an id already assigned. */
  static newGiftTree(name) {
    return newGiftTree(name);
  }

  /** Write one tree into the library, leaving the rest alone. GM-only. */
  static async saveGiftTree(tree) {
    await saveGiftTree(tree);
    app.ui?.refresh();
    return getGiftTrees().length;
  }

  /** Drop a tree. Students assigned to it simply stop seeing it. GM-only. */
  static async deleteGiftTree(id) {
    await deleteGiftTree(id);
    app.ui?.refresh();
    return true;
  }

  /** Put a student on a list of trees — usually the shared trunk plus theirs. */
  static async assignGiftTrees(actorNameOrId, ids) {
    const a = resolveActor(actorNameOrId);
    if (!a) return ui.notifications.error("Actor not found."), false;
    const done = await assignGiftTrees(a, ids);
    if (done) app.ui?.refresh();
    return done;
  }

  /** Everything a student can see, composed into one graph. */
  static giftGraph(actorNameOrId) {
    const a = resolveActor(actorNameOrId);
    return a ? resolveGiftTree(a) : null;
  }

  /** Hand a student points to spend. */
  static async grantGiftPoints(actorNameOrId, amount, reason = "") {
    const a = resolveActor(actorNameOrId);
    if (!a) return ui.notifications.error("Actor not found."), null;
    const left = await grantGiftPoints(a, amount, reason);
    app.ui?.refresh();
    return left;
  }

  /**
   * Give a node back, with anything that depended on it.
   *
   * `{preview: true}` names what would go without writing anything, which is
   * what the confirmation is built on.
   */
  static async refundGift(actorNameOrId, nodeId, opts = {}) {
    const a = resolveActor(actorNameOrId);
    if (!a) return { ok: false, why: "actor not found" };
    return refundGiftNode(a, nodeId, opts);
  }

  /** Every node back, every point back, every granted item removed. */
  static async resetGift(actorNameOrId) {
    const a = resolveActor(actorNameOrId);
    if (!a) return { ok: false, why: "actor not found" };
    return resetGiftTree(a);
  }

  /** What makes a tree unplayable: cycles, dead edges, unreachable nodes. */
  static validateGift(treeId) {
    return validateGiftTree(treeId);
  }

  /** The grants in a tree whose UUID no longer resolves. Hits the database. */
  static async deadGifts(treeId) {
    return deadGrants(treeId);
  }

  /** Issue notebooks to any student who does not have one yet. GM-only. */
  static async issueNotebooks() {
    const n = await provisionNotebooks();
    ui.notifications.info(`${n} notebook${n === 1 ? "" : "s"} accounted for.`);
    return n;
  }

  // -------------------------------------------------------------------------
  //  Queued messages
  // -------------------------------------------------------------------------

  /** Everything written in advance and waiting for a button. GM-only. */
  static queued() {
    return getQueued();
  }

  /**
   * Fire one of them.
   *
   * Delivery is `sendNPCMessage` per recipient, which is the same write the
   * Command Center's Messages tab does — a GM owns every actor, so there is no
   * relay involved and no GM-connected caveat. The extra ping at the end is what
   * turns it into a toast on the recipient's screen rather than a silent arrival.
   *
   * The entry stays afterwards, with a count. The good ones get used again.
   */
  static async sendQueued(id) {
    if (!game.user.isGM) {
      ui.notifications.warn("Only a GM can send a queued message.");
      return 0;
    }

    const entry = getQueued().find(q => q.id === id);
    if (!entry) return 0;
    if (!String(entry.text ?? "").trim()) {
      ui.notifications.warn("That message has nothing in it.");
      return 0;
    }
    if (!String(entry.from ?? "").trim()) {
      ui.notifications.warn("Give it a name to come from.");
      return 0;
    }

    // A Map keyed by id, because "all" and a hand-picked list can both name the
    // same actor twice when two users share a character.
    const targets = new Map();
    if (entry.to === "all") {
      for (const a of studentActors()) targets.set(a.id, a);
    } else {
      for (const aid of entry.to ?? []) {
        const a = game.actors.get(aid);
        if (a) targets.set(a.id, a);
      }
    }
    if (!targets.size) {
      ui.notifications.warn("Nobody is set to receive it.");
      return 0;
    }

    for (const actor of targets.values()) {
      await ZenithAPI.sendNPCMessage(actor.id, entry.from, entry.text, "", entry.image ?? "");
    }

    await markQueuedSent(id);
    emitDelivered([...targets.keys()], entry.from);

    const n = targets.size;
    ui.notifications.info(`Sent to ${n} student${n === 1 ? "" : "s"}.`);
    return n;
  }

  /** Write one into the queue without opening the Command Center. GM-only. */
  static async queueMessage({ label = "", from = "", text = "", image = "", to = "all" } = {}) {
    if (!game.user.isGM) {
      ui.notifications.warn("Only a GM can queue a message.");
      return null;
    }
    const list = getQueued();
    const entry = { id: `q_${Math.random().toString(36).slice(2, 10)}`, label, from, text, image, to };
    list.push(entry);
    await setQueued(list);
    return entry.id;
  }

  // -------------------------------------------------------------------------
  //  Maps
  // -------------------------------------------------------------------------

  /** Every map, pins and all — including the ones students cannot see. GM view. */
  static maps() {
    return getMaps();
  }

  /**
   * Reveal a marker the party has just found.
   *
   * The one map operation worth a macro: everything else is editing, which the
   * Command Center does better, but "they found it" happens mid-scene.
   */
  static async revealPin(mapNameOrId, pinLabelOrId, found = true) {
    if (!game.user.isGM) {
      ui.notifications.warn("Only a GM can reveal a marker.");
      return false;
    }
    const maps = getMaps();
    const map = maps.find(m => m.id === mapNameOrId || m.name === mapNameOrId);
    if (!map) return ui.notifications.warn("No such map."), false;

    const pin = (map.pins ?? []).find(p => p.id === pinLabelOrId || p.label === pinLabelOrId);
    if (!pin) return ui.notifications.warn("No such marker."), false;

    pin.found = !!found;
    await setMaps(maps);
    ui.notifications.info(`${pin.label || "The marker"} is now ${found ? "visible" : "hidden"}.`);
    return true;
  }

  // -------------------------------------------------------------------------
  //  Housekeeping
  // -------------------------------------------------------------------------

  /**
   * Find captures no gallery points at, and ask what to do with them.
   *
   * Prints the list to the console and opens the keep-or-delete panel. GM-only.
   */
  static async sweepCaptures() {
    return sweepCaptures();
  }

  /**
   * The same sweep with no interface — the list, for a macro to do its own
   * thing with. GM-only.
   */
  static async orphanCaptures() {
    return findOrphanCaptures();
  }

  // -------------------------------------------------------------------------
  //  World content  (GM only)
  // -------------------------------------------------------------------------

  /** Post a notice to the school board. Every student sees it. */
  static async postNotice(text, time = "") {
    if (!game.user.isGM) return ui.notifications.warn("Only a GM can post a notice.");
    const list = getAnnouncements();
    list.push({ text, time: time || getAutoTime(), pinned: false, ts: Date.now() });
    await setAnnouncements(list);

    for (const a of studentActors()) {
      await pushNotification(a, {
        icon: "fa-bullhorn", title: "New notice",
        body: String(text ?? "").slice(0, 90), app: "notices",
      });
    }
    app.ui?.refresh();
  }

  /**
   * Add or update a school event. Matching on name means calling this again
   * with a smaller number is how you count a date down day by day.
   */
  static async setSchoolEvent(name, days = 0) {
    if (!game.user.isGM) return ui.notifications.warn("Only a GM can set an event.");
    const list = getEvents();
    const existing = list.find(e => e.name === name);
    if (existing) existing.days = Number(days) || 0;
    else list.push({ id: evtId(), name, days: Number(days) || 0, detail: "" });
    await setEvents(list);
    app.ui?.refresh();
  }

  /** Remove a school event by name. */
  static async clearSchoolEvent(name) {
    if (!game.user.isGM) return ui.notifications.warn("Only a GM can clear an event.");
    await setEvents(getEvents().filter(e => e.name !== name));
    app.ui?.refresh();
  }

  /** Advance every scheduled event by one day. Handy at the end of a session. */
  static async advanceDay(days = 1) {
    if (!game.user.isGM) return ui.notifications.warn("Only a GM can advance the calendar.");
    const list = getEvents().map(e => ({ ...e, days: (Number(e.days) || 0) - days }));
    await setEvents(list);
    app.ui?.refresh();
  }

  // -------------------------------------------------------------------------
  //  Deprecated  (v1.6 signatures, kept so existing macros keep working)
  // -------------------------------------------------------------------------

  /**
   * @deprecated Events are world content as of v1.7 — use `setSchoolEvent`.
   * The actor argument is ignored; setting an event for one student and not
   * another is exactly the drift C1 removed.
   */
  static async setEvent(_actorNameOrId, name, days) {
    console.warn(`zenith-scroll | setEvent(actor, name, days) is deprecated; use setSchoolEvent(name, days).`);
    return ZenithAPI.setSchoolEvent(name, days);
  }

  /** @deprecated Use `setSchoolEvent` — every student already shares the calendar. */
  static async setEventAll(name, days) {
    return ZenithAPI.setSchoolEvent(name, days);
  }
}
