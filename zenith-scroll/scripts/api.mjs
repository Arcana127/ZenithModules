/**
 * Zenith Academy Scroll — macro API
 *
 * Exposed as `game.modules.get("zenith-scroll").api` for use from macros and
 * journal script buttons, e.g.
 *
 *   const zs = game.modules.get("zenith-scroll").api;
 *   await zs.sendNPCMessage("Rin Adler", "Prof. Hale", "See me after class.");
 *   await zs.adjustRelationship("Rin Adler", "Prof. Hale", +1, "Covered for her");
 *
 * Every method takes an actor name or id. These write flags directly, so they
 * must be run by a GM (or by whoever owns the target actor).
 */

import { F, convId, getAutoTime, relInfo, app } from "./core.mjs";
import { loadSection, saveSection } from "./data.mjs";

/** Resolve an actor from either an id or a name. */
function resolveActor(actorNameOrId) {
  return game.actors.get(actorNameOrId) ?? game.actors.getName(actorNameOrId);
}

/** Every player character in the world, as actors. */
function studentActors() {
  return game.users.filter(u => !u.isGM && u.character).map(u => u.character);
}

export class ZenithAPI {

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
    app.icon?.pulse();
    app.icon?.updateBadge(a);
    app.ui?.refresh();
  }

  /** Same, to every student at once. */
  static async sendNPCMessageAll(npcName, text, time = "", image = "") {
    for (const a of studentActors()) {
      await ZenithAPI.sendNPCMessage(a.id, npcName, text, time, image);
    }
  }

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
    app.ui?.refresh();
  }

  static async addGalleryImage(actorNameOrId, src, caption = "") {
    const a = resolveActor(actorNameOrId);
    if (!a) return;

    const media = loadSection(a, F.media);
    media.gallery.push({ src, caption });

    await saveSection(a, F.media, media);
    app.icon?.pulse();
    app.ui?.refresh();
  }

  static async setEvent(actorNameOrId, name, days) {
    const a = resolveActor(actorNameOrId);
    if (!a) return;

    const ac = loadSection(a, F.academic);
    ac.nextEvent = name;
    ac.nextEventDays = days;

    await saveSection(a, F.academic, ac);
    app.ui?.refresh();
  }

  static async setEventAll(name, days) {
    for (const a of studentActors()) {
      await ZenithAPI.setEvent(a.id, name, days);
    }
  }
}
