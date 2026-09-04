/**
 * Zenith Academy Scroll — socket relay and toasts
 *
 * Player-to-player messaging goes through the GM client. A player writes their
 * own copy of the message locally, then emits; the GM receives it and writes it
 * into each recipient actor's flags on their behalf, because players can't write
 * flags on an actor they don't own.
 *
 * That makes a connected GM a hard requirement for delivery — callers must check
 * `gmOnline()` before writing anything locally, so a thread never shows a message
 * that was never delivered.
 */

import { M, F, el, esc, app } from "./core.mjs";
import { loadSection, saveSection, playerActor } from "./data.mjs";

// ---------------------------------------------------------------------------
//  Availability
// ---------------------------------------------------------------------------

/** World setting gate for player-to-player messaging. */
export function msgEnabled() {
  try { return game.settings.get(M, "enablePlayerMessaging"); }
  catch (e) { return true; }   // setting not registered yet; don't block
}

/** Is any GM connected to relay? Without one, player messages cannot be delivered. */
export function gmOnline() {
  return game.users.some(u => u.isGM && u.active);
}

// ---------------------------------------------------------------------------
//  Relay
// ---------------------------------------------------------------------------

export function initSocket() {
  game.socket.on(`module.${M}`, async (payload) => {

    // ---- GM side: write the message into each recipient's flags ----
    if (payload.type === "sendMessage" && game.user.isGM) {
      if (!msgEnabled()) {
        console.warn(`${M} | Relay refused: player messaging is disabled.`);
        return;
      }

      // Only relay on behalf of a user who actually owns the actor they claim to be
      const sender = game.users.get(payload.userId);
      const claimed = game.actors.getName(payload.senderName);
      if (!sender || !claimed || !(sender.isGM || claimed.testUserPermission(sender, "OWNER"))) {
        console.warn(`${M} | Relay refused: unverified sender.`, payload);
        return;
      }

      for (const targetId of payload.targetActorIds) {
        const actor = game.actors.get(targetId);
        if (!actor) continue;

        const social = loadSection(actor, F.social);

        // Match the existing conversation by id first. Falling back to creating a
        // new one without this check is what used to split group chats in two.
        let conv = social.conversations.find(c => c.id === payload.convId);
        if (!conv && payload.isGroup) {
          conv = social.conversations.find(
            c => c.isGroup && c.title === payload.title && c.participants.includes(actor.name));
          if (conv) conv.id = payload.convId;
        }
        if (!conv) {
          conv = {
            id: String(payload.convId),
            participants: (payload.participants || []).map(String),
            title: payload.title ? String(payload.title) : null,
            isGroup: !!payload.isGroup,
            messages: [],
            muted: false,
          };
          social.conversations.push(conv);
        }

        // Take only the fields we understand rather than spreading whatever
        // arrived off the wire straight into the target's flags.
        const inb = payload.message ?? {};
        conv.messages.push({
          from: String(inb.from ?? payload.senderName ?? ""),
          text: String(inb.text ?? ""),
          time: String(inb.time ?? ""),
          ts: Number(inb.ts) || Date.now(),
          image: String(inb.image ?? ""),
          sent: false,
          read: false,
        });

        await saveSection(actor, F.social, social);
      }

      // Tell every client to re-read; only the recipients will react
      game.socket.emit(`module.${M}`, {
        type: "refresh",
        actorIds: payload.targetActorIds,
        senderName: payload.senderName,
      });
    }

    // ---- Every client: refresh if this concerns me ----
    if (payload.type === "refresh") {
      const myActor = playerActor();
      if (myActor && payload.actorIds.includes(myActor.id)) {
        app.icon?.updateBadge(myActor);
        app.ui?.refresh();
        app.icon?.pulse();
        showToast(payload.senderName || "Someone", "sent you a message");
      }
    }
  });
}

export function emitMessage(convId, participants, title, isGroup, message, targetActorIds, senderName) {
  game.socket.emit(`module.${M}`, {
    type: "sendMessage",
    convId, participants, title, isGroup, message, targetActorIds, senderName,
    userId: game.user.id,   // the GM verifies this against actor ownership
  });
}

// ---------------------------------------------------------------------------
//  Toasts
// ---------------------------------------------------------------------------

/** How many toasts stay on screen at once before the oldest is dropped. */
const MAX_TOASTS = 3;

/**
 * Show a transient notification above the scroll icon. Clicking one opens the
 * scroll. Toasts stack rather than replacing each other, so two messages
 * arriving together don't cost you the first one.
 */
export function showToast(title, body) {
  let host = document.getElementById("zs-toasts");
  if (!host) {
    host = el("div", { id: "zs-toasts" });
    document.body.appendChild(host);
  }
  while (host.children.length >= MAX_TOASTS) host.firstElementChild.remove();

  const toast = el("div", {
    class: "zs-toast",
    html: `<div class="zst-title">${esc(title)}</div><div class="zst-body">${esc(body)}</div>`,
    onclick: () => {
      toast.remove();
      const a = playerActor();
      if (a) app.ui?.show(a);
    },
  });
  host.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("zst-out");
    setTimeout(() => toast.remove(), 400);
  }, 5000);
}
