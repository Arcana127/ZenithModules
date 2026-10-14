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

import { M, F, el, esc, app, btn, uid, safeImageSrc } from "./core.mjs";
import { loadSection, saveSection, playerActor, pushNotification } from "./data.mjs";
import {
  uploadCapture, captureDir, captureName, finishDeveloping, failDeveloping,
} from "./capture.mjs";

/**
 * Ceiling on a relayed capture, in characters of base64.
 *
 * A 1600px JPEG lands around half a million; four million is roughly a 3MB
 * image, which is far more than the camera can produce and still small enough
 * that a malformed or hostile payload cannot wedge the GM's client.
 */
const MAX_CAPTURE_CHARS = 4_000_000;

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

        // The GM owns every actor, so the notification log for the recipient has
        // to be written here on their behalf — the recipient's own client can't
        // write it until they open the device, by which point the toast is gone.
        // A muted thread still logs; muting silences the toast, not the record.
        const sys = loadSection(actor, F.system);
        if (!Array.isArray(sys.notifications)) sys.notifications = [];
        sys.notifications.unshift({
          id: "ntf_" + Math.random().toString(36).slice(2, 10),
          icon: "fa-comment-dots",
          title: String(inb.from ?? payload.senderName ?? "Someone"),
          body: String(inb.text ?? "").slice(0, 90),
          app: "messages",
          ts: Number(inb.ts) || Date.now(),
          read: false,
        });
        sys.notifications = sys.notifications.slice(0, 40);
        await saveSection(actor, F.system, sys, { silent: true });
      }

      // Tell every client to re-read; only the recipients will react
      game.socket.emit(`module.${M}`, {
        type: "refresh",
        actorIds: payload.targetActorIds,
        convId: payload.convId,
        senderName: payload.senderName,
      });
    }


    // ---- GM side: tell a sender their message has been read ----
    if (payload.type === "readReceipt" && game.user.isGM) {
      const reader = game.users.get(payload.userId);
      const readerActor = game.actors.getName(payload.readerName);
      if (!reader || !readerActor ||
          !(reader.isGM || readerActor.testUserPermission(reader, "OWNER"))) {
        console.warn(`${M} | Receipt refused: unverified reader.`, payload?.userId);
        return;
      }

      /*
       * A receipt has to reach the *sender's own copy* of the message, which
       * lives in their actor's flags and which the reader cannot write. Marks
       * are grouped by who sent them, because one trip through a thread can
       * read messages from several people at once and each of them needs their
       * own write.
       */
      const bySender = new Map();
      for (const mark of payload.marks ?? []) {
        const from = String(mark?.from ?? "");
        const ts = Number(mark?.ts);
        if (!from || !ts) continue;
        if (!bySender.has(from)) bySender.set(from, new Set());
        bySender.get(from).add(ts);
      }

      const touched = [];
      for (const [from, stamps] of bySender) {
        // An NPC has no scroll to mark. Silently skipped rather than warned
        // about — most threads have one in them.
        const actor = game.actors.getName(from);
        if (!actor) continue;

        const social = loadSection(actor, F.social);
        const conv = social.conversations?.find(c => c.id === payload.convId);
        if (!conv) continue;

        let changed = false;
        for (const msg of conv.messages ?? []) {
          if (!msg.sent || !stamps.has(Number(msg.ts))) continue;
          if (!msg.seen) { msg.seen = true; changed = true; }
          const by = Array.isArray(msg.seenBy) ? msg.seenBy : [];
          if (!by.includes(payload.readerName)) {
            by.push(String(payload.readerName));
            msg.seenBy = by;
            changed = true;
          }
        }
        if (!changed) continue;

        await saveSection(actor, F.social, social, { silent: true });
        touched.push(actor.id);
      }

      if (touched.length) {
        game.socket.emit(`module.${M}`, { type: "seenRefresh", actorIds: touched });
      }
    }

    // ---- Every client: a message I sent has been read ----
    if (payload.type === "seenRefresh") {
      const mine = playerActor();
      // No toast and no pulse: a tick turning is not an event, it is a detail.
      if (mine && (payload.actorIds ?? []).includes(mine.id)) app.ui?.refresh();
    }

    // ---- GM side: file a shared image in each recipient's gallery ----
    if (payload.type === "shareImage" && game.user.isGM) {
      const sender = game.users.get(payload.userId);
      const claimed = game.actors.getName(payload.senderName);
      if (!sender || !claimed || !(sender.isGM || claimed.testUserPermission(sender, "OWNER"))) {
        console.warn(`${M} | Share refused: unverified sender.`, payload);
        return;
      }

      // The src arrives off the wire and goes straight into an <img>, so it is
      // checked here rather than trusted. A data: URL is refused on top of that
      // — it would be megabytes of base64 written into another player's flags.
      const src = safeImageSrc(payload.src);
      if (!src) {
        console.warn(`${M} | Share refused: unusable image path.`, payload?.src);
        return;
      }
      const caption = String(payload.caption ?? "").slice(0, 140);

      const reached = [];
      for (const targetId of payload.targetActorIds ?? []) {
        const actor = game.actors.get(targetId);
        if (!actor) continue;

        const media = loadSection(actor, F.media);
        if (!Array.isArray(media.gallery)) media.gallery = [];
        media.gallery.push({
          id: uid("img"), src, caption,
          from: String(payload.senderName ?? ""), ts: Date.now(),
        });
        await saveSection(actor, F.media, media);

        // Same reasoning as the message relay: the recipient's own client can't
        // write this, and by the time they open the device the toast is gone.
        const sys = loadSection(actor, F.system);
        if (!Array.isArray(sys.notifications)) sys.notifications = [];
        sys.notifications.unshift({
          id: uid("ntf"),
          icon: "fa-image",
          title: String(payload.senderName ?? "Someone"),
          body: caption ? `shared an image: ${caption}` : "shared an image with you",
          app: "gallery",
          ts: Date.now(),
          read: false,
        });
        sys.notifications = sys.notifications.slice(0, 40);
        await saveSection(actor, F.system, sys, { silent: true });

        reached.push(targetId);
      }

      game.socket.emit(`module.${M}`, {
        type: "mediaRefresh",
        actorIds: reached,
        senderName: payload.senderName,
        caption,
        toast: true,
      });
    }

    // ---- GM side: write a player's camera capture to disk for them ----
    if (payload.type === "storeCapture" && game.user.isGM) {
      const sender = game.users.get(payload.userId);
      const actor = game.actors.get(payload.actorId);
      if (!sender || !actor || !(sender.isGM || actor.testUserPermission(sender, "OWNER"))) {
        console.warn(`${M} | Capture refused: unverified sender.`, payload?.userId);
        return;
      }
      if (!/^data:image\/(?:jpeg|png|webp);base64,/i.test(String(payload.dataUrl ?? ""))) {
        console.warn(`${M} | Capture refused: not an image data URL.`);
        return;
      }
      if (String(payload.dataUrl).length > MAX_CAPTURE_CHARS) {
        console.warn(`${M} | Capture refused: too large.`);
        return;
      }

      try {
        // The directory and filename are generated here, never taken from the
        // payload — a client-supplied path is a directory traversal waiting to
        // happen, and this runs with the GM's file permissions.
        const path = await uploadCapture(payload.dataUrl, captureDir(), captureName(actor));

        const media = loadSection(actor, F.media);
        if (!Array.isArray(media.gallery)) media.gallery = [];
        media.gallery.push({
          id: uid("img"), src: path,
          caption: String(payload.caption ?? "").slice(0, 140),
          from: "", ts: Date.now(),
        });
        await saveSection(actor, F.media, media);

        // `pendingId` is the photographer's own token for this capture. It goes
        // out with the request and comes back untouched, which is what lets
        // their client take the right tile out of the darkroom rather than
        // guessing that the next arrival is theirs.
        game.socket.emit(`module.${M}`, {
          type: "mediaRefresh", actorIds: [actor.id], toast: false,
          capturedFor: payload.userId, pendingId: payload.pendingId,
        });
      } catch (e) {
        console.error(`${M} | could not store a capture for ${actor.name}`, e);
        game.socket.emit(`module.${M}`, {
          type: "captureFailed", userId: payload.userId,
          pendingId: payload.pendingId, reason: String(e?.message ?? e),
        });
      }
    }

    // ---- Every client: someone's gallery changed ----
    if (payload.type === "mediaRefresh") {
      const myActor = playerActor();
      if (myActor && (payload.actorIds ?? []).includes(myActor.id)) {
        app.icon?.updateBadge(myActor);
        app.ui?.refresh();
        if (payload.toast) {
          app.icon?.pulse();
          showToast(payload.senderName || "Someone",
            payload.caption ? `shared an image: ${payload.caption}` : "shared an image with you",
            { icon: "fa-image", appId: "gallery" });
        }
      }
      if (payload.capturedFor === game.user.id) {
        if (payload.pendingId) finishDeveloping(payload.pendingId);
        ui.notifications.info("Photo saved to your gallery.");
        app.ui?.refresh();
      }
    }

    // ---- Every client: the GM could not write my capture ----
    if (payload.type === "captureFailed" && payload.userId === game.user.id) {
      // The tile stays, marked, until the player dismisses it — a photo that
      // silently disappeared would be worse than one that says it failed.
      if (payload.pendingId) failDeveloping(payload.pendingId, payload.reason);
      ui.notifications.error(`The photo could not be saved: ${payload.reason}`);
      app.ui?.refresh();
    }
    // ---- Every client: refresh if this concerns me ----
    if (payload.type === "refresh") {
      const myActor = playerActor();
      if (myActor && payload.actorIds.includes(myActor.id)) {
        app.icon?.updateBadge(myActor);
        app.ui?.refresh();

        // A muted conversation delivers silently: no pulse, no toast. The
        // message is still written and still shows in the notification centre,
        // which is what `muted` has always been stored to mean and never did.
        if (!isMuted(myActor, payload.convId)) {
          app.icon?.pulse();
          showToast(payload.senderName || "Someone", "sent you a message");
        }
      }
    }
  });
}

/** Has this actor muted the conversation the incoming message belongs to? */
function isMuted(actor, convId) {
  if (!convId) return false;
  const social = loadSection(actor, F.social);
  return !!social.conversations?.find(c => c.id === convId)?.muted;
}

export function emitMessage(convId, participants, title, isGroup, message, targetActorIds, senderName) {
  game.socket.emit(`module.${M}`, {
    type: "sendMessage",
    convId, participants, title, isGroup, message, targetActorIds, senderName,
    userId: game.user.id,   // the GM verifies this against actor ownership
  });
}


/**
 * Tell every client that something landed in these actors' threads.
 *
 * The `refresh` branch already does the recipient side — badge, repaint, pulse,
 * toast — so a GM writing a message directly (a queued one, a macro) only needs
 * to say so. It carries no content: the write has already happened, in flags
 * every client can read for itself.
 */
export function emitDelivered(actorIds, senderName, convId = null) {
  if (!actorIds?.length) return;
  game.socket.emit(`module.${M}`, { type: "refresh", actorIds, convId, senderName });
}

/**
 * Tell the GM which messages I have just read, so their senders can be told.
 *
 * `marks` carries `{from, ts}` rather than message ids because messages have
 * never had ids — `ts` is what the relay has always matched on, and it is
 * assigned by the sender, so both copies agree on it.
 */
export function emitReadReceipt(convId, marks, readerName) {
  if (!marks?.length) return;
  game.socket.emit(`module.${M}`, {
    type: "readReceipt",
    convId, marks, readerName,
    userId: game.user.id,
  });
}

/**
 * Ask the GM to file an image in other students' galleries.
 *
 * Same relay, same reason as messages: a player cannot write another player's
 * actor flags, so the GM's client does it on their behalf after checking that
 * the sender really owns the actor they claim to be.
 */
export function emitShareImage(src, caption, targetActorIds, senderName) {
  game.socket.emit(`module.${M}`, {
    type: "shareImage",
    src, caption, targetActorIds, senderName,
    userId: game.user.id,
  });
}

/**
 * Ask the GM to write a camera capture to disk and file it in my gallery.
 *
 * Only used when this client cannot upload for itself — most players can't,
 * since Foundry's upload permission is off for them by default.
 */
export function emitStoreCapture(dataUrl, actorId, caption = "", pendingId = "") {
  game.socket.emit(`module.${M}`, {
    type: "storeCapture",
    dataUrl, actorId, caption, pendingId,
    userId: game.user.id,
  });
}

// ---------------------------------------------------------------------------
//  Toasts
// ---------------------------------------------------------------------------

/** How many toasts stay on screen at once before the oldest is dropped. */
const MAX_TOASTS = 3;

/**
 * Show a transient notification beside the bracelet. Clicking one opens the
 * device. Toasts stack rather than replacing each other, so two messages
 * arriving together don't cost you the first one.
 *
 * `log` controls whether it is also written to the notification centre. The
 * relay already writes the recipient's log itself (a player can't write their
 * own flags fast enough to beat the toast), so message toasts pass false and
 * everything raised locally passes true.
 */
export function showToast(title, body, { icon = "fa-bell", appId = null, log = false } = {}) {
  let host = document.getElementById("zs-toasts");
  if (!host) {
    host = el("div", { id: "zs-toasts", role: "status", "aria-live": "polite" });
    document.body.appendChild(host);
  }
  while (host.children.length >= MAX_TOASTS) host.firstElementChild.remove();

  const toast = btn("zs-toast", `${title}: ${body}. Open the scroll.`, () => {
    toast.remove();
    const a = playerActor();
    if (a) app.ui?.show(a, appId);
  });
  toast.innerHTML =
    `<i class="fa-solid ${esc(icon)} zst-icon" aria-hidden="true"></i>` +
    `<span class="zst-copy"><span class="zst-title">${esc(title)}</span>` +
    `<span class="zst-body">${esc(body)}</span></span>`;
  host.appendChild(toast);

  if (log) {
    const a = playerActor();
    if (a) pushNotification(a, { icon, title, body, app: appId }).catch(() => {});
  }

  setTimeout(() => {
    toast.classList.add("zst-out");
    setTimeout(() => toast.remove(), 400);
  }, 5000);
}
