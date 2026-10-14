/**
 * Zenith Academy Scroll — player interface
 *
 * ScrollIcon: the bracelet the student wears, sitting on the canvas.
 * ScrollUI:   the projection it opens, one view at a time.
 *
 * The shell is a three-level stack — lock screen, home app grid, app — held in
 * `view` / `appId`, with in-app view state (`convId`, `relContact`) below that.
 * All of it is re-resolved on render, because a re-render throws the DOM away.
 *
 * v1.7 stopped rebuilding the *frame* on every state change: `render()` builds
 * the projection once and `_paint()` swaps only the stage inside it. That is
 * what makes the view transitions possible, and it means the dock and the
 * frame's own entry animation survive a refresh. Anything that autosaves while
 * the user is typing should still save with `{silent: true}`; `_paint()`
 * restores focus and selection as a backstop, not a licence.
 *
 * The stage holds one view, or two while a transition is crossing over. Views
 * are appended, so the *last* child is always the live one — see `_paint()` for
 * what reading that as the first child cost.
 *
 * v1.8 removed the status bar. Of the four things it carried, the clock was a
 * smaller duplicate of the lock screen's and the charge meter was pure flavour,
 * so both are simply gone; the bell became the Alerts app plus a badge in the
 * home header, and the aether meter became a strip that appears in Messages
 * only when there is genuinely no link.
 */

import {
  M, FP, F, el, btn, esc, app, APPS, appInfo, relInfo, accentInfo, ACCENTS,
  yearLabel, daysLabel, convId, getAutoTime, getAutoDate, getClock, relTime,
  reducedMotion, confirmDialog, BRACELET_SVG, primaryCurrency, safeImageSrc,
} from "./core.mjs";
import {
  loadAll, loadSection, saveSection, playerActor, portraitOf, resolveKeyArt,
  resolvePortrait, findPortrait, totalUnread, announcementsFor, unreadNotices,
  getNotifications, unseenNotifications, markNotificationsSeen, clearNotifications,
  dismissNotification, getBalances, getCurrency, getLedger,
  getGallery, addGalleryImage, removeGalleryImage,
} from "./data.mjs";
import { nextEvent, visibleMaps } from "./world.mjs";
import { resolveGiftTree, giftNodeState, unlockGiftNode } from "./gift.mjs";
import {
  emitMessage, emitShareImage, emitStoreCapture, emitReadReceipt, msgEnabled, gmOnline,
} from "./socket.mjs";
import {
  BOOKS, listNotes, noteCount, bookFor, canWrite as canWriteNotes, createNote,
  saveNote, deleteNote, popOut as popOutNotes,
} from "./notes.mjs";
import {
  captureViewport, canCapture, canUploadDirectly, uploadCapture, captureDir, captureName,
  beginDeveloping, developing, finishDeveloping,
} from "./capture.mjs";

// ===========================================================================
//  SCROLL ICON  —  the bracelet
// ===========================================================================

export class ScrollIcon {
  constructor() {
    this.el = null;
    this._dragged = false;   // suppresses the click that ends a drag
    this._pulse = null;      // pulse timer, so overlapping pulses don't cut each other short
    this._onResize = null;
  }

  inject() {
    if (this.el) return;

    const d = el("div", { id: "zs-icon" });
    d.innerHTML =
      `<div class="zsi-device">${BRACELET_SVG}<div class="zsi-emit"></div></div>` +
      `<div class="zsi-label">SCROLL</div>` +
      `<div class="zsi-badge" style="display:none" aria-hidden="true">0</div>`;

    // The whole thing is a button so it can be tabbed to and opened with Enter.
    const hit = btn("zsi-hit", "Open your scroll", () => {
      if (this._dragged) return;
      const a = playerActor();
      if (!a) return ui.notifications.warn("No character assigned.");
      app.ui?.toggle(a);
    });
    d.appendChild(hit);

    d.addEventListener("contextmenu", e => {
      e.preventDefault();
      if (game.user.isGM) app.gm?.open();
    });

    this._makeDraggable(d);

    document.body.appendChild(d);
    this.el = d;

    this.applyAccent();

    const saved = game.user.getFlag(M, FP);
    if (saved) {
      d.style.left = saved.x + "px";
      d.style.top = saved.y + "px";
      d.style.right = "auto";
      d.style.bottom = "auto";
    }

    this.clampIntoView();
    this._onResize = () => this.clampIntoView();
    window.addEventListener?.("resize", this._onResize);
  }

  /**
   * Tint the stone to the student's chosen accent.
   *
   * The bracelet on the canvas is the same object as the one that projects the
   * screen, so it has to carry the same accent — otherwise picking "Ember" in
   * Settings gives you an orange screen hanging off a cyan stone.
   */
  applyAccent(actor) {
    if (!this.el) return;
    const a = actor ?? playerActor();
    const acc = accentInfo(a ? loadSection(a, F.prefs).accent : "aether");
    this.el.style.setProperty("--zd-accent", acc.hue);
    this.el.style.setProperty("--zd-accent-deep", acc.deep);
    this.el.style.setProperty("--zd-accent-bright", acc.bright);
  }

  /** Drag with the left button; position persists on the user flag. */
  _makeDraggable(d) {
    let sx, sy, ox, oy;

    d.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      this._dragged = false;
      sx = e.clientX;
      sy = e.clientY;
      const r = d.getBoundingClientRect();
      ox = e.clientX - r.left;
      oy = e.clientY - r.top;

      const mv = ev => {
        // 4px of slop, so a slightly shaky click still counts as a click
        if (Math.abs(ev.clientX - sx) > 4 || Math.abs(ev.clientY - sy) > 4) this._dragged = true;
        if (!this._dragged) return;
        d.style.left = (ev.clientX - ox) + "px";
        d.style.top = (ev.clientY - oy) + "px";
        d.style.right = "auto";
        d.style.bottom = "auto";
      };

      const up = () => {
        document.removeEventListener("pointermove", mv);
        document.removeEventListener("pointerup", up);
        if (this._dragged) {
          const r2 = d.getBoundingClientRect();
          game.user.setFlag(M, FP, { x: r2.left, y: r2.top });
          // Clear the flag after the click event has passed
          setTimeout(() => this._dragged = false, 60);
        }
      };

      document.addEventListener("pointermove", mv);
      document.addEventListener("pointerup", up);
    });
  }

  /** Move the bracelet and remember where it went. */
  _place(x, y) {
    const d = this.el;
    if (!d) return;
    const nx = Math.round(x), ny = Math.round(y);
    d.style.left = nx + "px";
    d.style.top = ny + "px";
    d.style.right = "auto";
    d.style.bottom = "auto";
    Promise.resolve(game.user.setFlag(M, FP, { x: nx, y: ny })).catch(() => {});
  }

  /**
   * Put the bracelet back in the middle of the screen.
   *
   * The recovery for a bracelet that has been dragged somewhere it cannot be
   * dragged back from — under a docked sidebar, or off the edge of a monitor
   * that is no longer attached. Reachable from the module settings sheet, from
   * Shift+G, and from the macro API.
   */
  centre() {
    const d = this.el;
    if (!d) return false;
    let r = null;
    try { r = d.getBoundingClientRect(); } catch (e) { /* headless */ }
    this._place((window.innerWidth - (r?.width || 120)) / 2,
                (window.innerHeight - (r?.height || 140)) / 2);
    this.pulse();
    return true;
  }

  /**
   * Pull the bracelet back inside the viewport.
   *
   * A position saved on a wide monitor is off the edge of a narrow one, and a
   * bracelet you cannot see is a bracelet you cannot drag back. This runs on
   * inject and on every resize, and writes only when the bracelet is genuinely
   * outside — so it never fights a drag in progress and never spams the user
   * flag while a window is being dragged wider.
   */
  clampIntoView() {
    const d = this.el;
    if (!d || this._dragged) return;
    let r;
    try { r = d.getBoundingClientRect(); } catch (e) { return; }
    if (!r.width && !r.height) return;   // not laid out yet, or display:none

    const EDGE = 8;
    const x = Math.min(Math.max(r.left, EDGE), Math.max(EDGE, window.innerWidth - r.width - EDGE));
    const y = Math.min(Math.max(r.top, EDGE), Math.max(EDGE, window.innerHeight - r.height - EDGE));
    if (Math.round(x) === Math.round(r.left) && Math.round(y) === Math.round(r.top)) return;
    this._place(x, y);
  }

  /** Viewport position of the focus stone — where the projection unfurls from. */
  stoneOrigin() {
    const r = this.el?.getBoundingClientRect();
    if (!r) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    // The stone sits at (32, 35) in the 64-unit SVG, and the label sits below
    // the artwork, so scale against the SVG's own box rather than the wrapper's.
    return { x: r.left + r.width * 0.5, y: r.top + (r.width * 35 / 64) };
  }

  /**
   * Flash the bracelet.
   *
   * Restarted rather than re-added: adding a class that is already present does
   * not replay the animation, and the second pulse's timer then stripped the
   * class part-way through the first one's — two messages arriving together
   * gave you one truncated flash instead of two.
   */
  pulse() {
    const d = this.el;
    if (!d) return;
    clearTimeout(this._pulse);
    d.classList.remove("zs-pulse");
    void d.offsetWidth;   // force a reflow, so the animation starts again from zero
    d.classList.add("zs-pulse");
    this._pulse = setTimeout(() => d.classList.remove("zs-pulse"), 1200);
  }

  badge(n) {
    const b = this.el?.querySelector(".zsi-badge");
    if (!b) return;
    if (n > 0) {
      b.textContent = n > 9 ? "9+" : n;
      b.style.display = "flex";
    } else {
      b.style.display = "none";
    }
  }

  updateBadge(a) {
    this.badge(totalUnread(a));
    this.applyAccent(a);
  }
}

// ===========================================================================
//  PLAYER UI  —  the projection
// ===========================================================================

export class ScrollUI {
  constructor() {
    this.el = null;
    this.stage = null;
    this.actor = null;
    this.open_ = false;

    this.view = "lock";      // "lock" | "home" | "app"
    this.appId = null;       // which app, when view === "app"
    this.convId = null;      // open conversation, within Messages
    this.relContact = null;  // open contact, within Contacts
    this.noteId = null;      // open note, within Notes
    this.notesBook = "personal";   // which notebook the Notes app is showing
    this.mapId = null;       // open map, within Maps
    this.pinId = null;       // open marker, within a map
    this.giftNode = null;    // open node's detail sheet, within Gift
    this.giftView = null;    // {x, y, z} pan and zoom of the tree board

    this._shot = null;       // the camera's unsaved capture, awaiting keep-or-retake
    this._attach = null;     // image queued on the message composer
    this._noteEcho = null;   // page id we are mid-save on, so our own write can't repaint us
    this._devTick = null;    // repaint timer while a photo is still developing

    this._clock = null;      // lock-screen tick
    this._keyHandler = null;
    this._tip = null;        // floating contact tooltip, parented to <body>
    this._dying = null;      // the projection currently fading out, if any
  }

  // -------------------------------------------------------------------------
  //  Lifecycle
  // -------------------------------------------------------------------------

  toggle(a) {
    if (this.open_ && this.actor?.id === a?.id) this.close();
    else this.show(a);
  }

  /**
   * Open the device.
   *
   * `startApp` jumps straight past the lock screen — a toast that says someone
   * messaged you should land you in Messages, not make you unlock first.
   */
  show(a, startApp = null) {
    this.actor = a;
    this.convId = null;
    this.relContact = null;
    this.noteId = null;
    this.notesBook = "personal";
    this.mapId = null;
    this.pinId = null;
    this._shot = null;
    this._attach = null;

    const prefs = loadSection(a, F.prefs);
    if (startApp) { this.view = "app"; this.appId = startApp; }
    else if (prefs.skipLock) { this.view = "home"; this.appId = null; }
    else { this.view = "lock"; this.appId = null; }

    this.open_ = true;
    this.render();
  }

  close() {
    this.open_ = false;
    clearTimeout(this._devTick);
    this._devTick = null;
    this._stopClock();
    this._hideTip();
    if (this._keyHandler) {
      document.removeEventListener("keydown", this._keyHandler);
      this._keyHandler = null;
    }
    if (this.el) {
      const dead = this.el;
      this.el = null;
      this.stage = null;
      /*
       * The fade-out is still a full-screen backdrop for another third of a
       * second. Reopening inside that window stacked a second one on top of it:
       * two dimming layers over the canvas, and the dying one still swallowing
       * the clicks meant for the new projection. Hold the reference so render()
       * can retire it the instant a new projection is built.
       */
      this._dying?.remove();
      this._dying = dead;
      dead.classList.add("zs-out");
      setTimeout(() => {
        if (this._dying === dead) this._dying = null;
        dead.remove();
      }, 320);
    }
  }

  /** Re-read and repaint the current view, keeping the frame and its animation. */
  refresh() {
    if (!this.open_ || !this.actor) return;
    if (!this.el) { this.render(); return; }
    this._syncChrome();
    this._paint(null);
  }

  // -------------------------------------------------------------------------
  //  Navigation
  // -------------------------------------------------------------------------

  /**
   * Move to another view.
   *
   * `dir` drives the transition: "fwd" pushes (new view slides in from the
   * right), "back" pops. Passing null cross-fades, which is what a data refresh
   * should look like.
   */
  go(view, appId = null, dir = "fwd") {
    this.view = view;
    this.appId = appId;
    if (view !== "app" || appId !== "messages") { this.convId = null; this._attach = null; }
    if (view !== "app" || appId !== "contacts") this.relContact = null;
    if (view !== "app" || appId !== "notes") this.noteId = null;
    if (view !== "app" || appId !== "map") { this.mapId = null; this.pinId = null; }
    if (view !== "app" || appId !== "camera") this._shot = null;
    // The pan and zoom go with the node sheet: coming back to the tree later
    // should frame the frontier again, which will have moved.
    if (view !== "app" || appId !== "gift") { this.giftNode = null; this.giftView = null; }
    this._syncChrome();
    this._paint(dir);
  }

  /** One step back up the stack: detail -> app -> home -> lock. */
  back() {
    if (this.convId) { this.convId = null; this._attach = null; this._paint("back"); return; }
    if (this.relContact) { this.relContact = null; this._paint("back"); return; }
    if (this.noteId) { this.noteId = null; this._paint("back"); return; }
    if (this.pinId) { this.pinId = null; this._paint("back"); return; }
    if (this.mapId) { this.mapId = null; this._paint("back"); return; }
    if (this.giftNode) { this.giftNode = null; this._paint("back"); return; }
    if (this.view === "app") { this.go("home", null, "back"); return; }
    if (this.view === "home") { this.go("lock", null, "back"); return; }
    this.close();
  }

  // -------------------------------------------------------------------------
  //  Frame
  // -------------------------------------------------------------------------

  render() {
    this.el?.remove();
    this._dying?.remove();
    this._dying = null;
    // Belt to that brace: anything still answering to #zs-ui is a projection
    // that outlived its owner, and it would sit over this one as a second
    // backdrop. There is only ever meant to be one.
    for (const stray of document.querySelectorAll?.("#zs-ui") ?? []) stray.remove();

    const prefs = loadSection(this.actor, F.prefs);
    const acc = accentInfo(prefs.accent);
    const calm = reducedMotion(prefs);

    const root = el("div", {
      id: "zs-ui",
      class: calm ? "zs-calm" : "",
      role: "dialog", "aria-modal": "true", "aria-label": "Zenith Scroll",
    });
    root.style.setProperty("--zd-accent", acc.hue);
    root.style.setProperty("--zd-accent-deep", acc.deep);
    root.style.setProperty("--zd-accent-bright", acc.bright);
    root.addEventListener("mousedown", e => { if (e.target === root) this.close(); });

    // Unfurl from the bracelet's stone rather than from the middle of nowhere.
    // The frame is centred by flex, so the animation only needs the delta from
    // the viewport centre to the stone.
    const o = app.icon?.stoneOrigin?.() ?? { x: innerWidth / 2, y: innerHeight / 2 };
    root.style.setProperty("--zs-dx", (o.x - innerWidth / 2) + "px");
    root.style.setProperty("--zs-dy", (o.y - innerHeight / 2) + "px");

    const emitter = el("div", {
      class: "zsu-emitter",
      style: { left: o.x + "px", top: o.y + "px" },
      "aria-hidden": "true",
    });
    root.appendChild(emitter);

    const frame = el("div", { class: "zsu-frame" });
    frame.appendChild(el("div", { class: "zsu-bloom", "aria-hidden": "true" }));
    frame.appendChild(el("div", { class: "zsu-edge", "aria-hidden": "true" }));

    const screen = el("div", { class: "zsu-screen" });
    screen.appendChild(el("div", { class: "zsu-grain", "aria-hidden": "true" }));
    screen.appendChild(el("div", { class: "zsu-sweep", "aria-hidden": "true" }));

    const stage = el("div", { class: "zsu-stage" });
    screen.appendChild(stage);
    this.stage = stage;

    screen.appendChild(this._dock());

    // The close control lives *inside* the screen now. At -14px it sat outside
    // the frame entirely, over the outer bloom, and on a short viewport — where
    // the frame is already clamped against the vh cap — it could end up under
    // the browser chrome with nothing to click.
    screen.appendChild(btn("zsu-close", "Close the scroll", () => this.close(), { html: "×" }));

    frame.appendChild(screen);
    root.appendChild(frame);
    document.body.appendChild(root);
    this.el = root;

    // The emitter is a fixed 200px glow at the bracelet's stone. If the bracelet
    // has been dragged near the middle of the screen it sits on top of the panel
    // it is supposed to be opening, and for 1.1s the whole interface reads muddy.
    // Layout is available as soon as the frame is in the document, so ask.
    try {
      const r = frame.getBoundingClientRect();
      if (r.width && o.x > r.left - 40 && o.x < r.right + 40 &&
                     o.y > r.top - 40  && o.y < r.bottom + 40) emitter.remove();
    } catch (e) { /* no layout (headless); leave the glow alone */ }

    this._paint(null, { first: true });
    this._startClock();
    this._bindKeys();
  }

  /**
   * Repaint the stage.
   *
   * The outgoing view is animated out and removed on its own; the incoming one
   * is built fresh. Focus, selection and scroll offsets are carried across so a
   * background refresh mid-sentence doesn't cost the player their typing. Fields
   * opt in by carrying `data-zs-field`, scrollers by `data-zs-scroll`.
   */
  _paint(dir, { first = false } = {}) {
    if (!this.stage) return;
    const calm = this.el?.classList.contains("zs-calm");
    this._hideTip();   // the tooltip is parented to <body>; nothing else will collect it

    const memo = this._captureState();

    const view = el("div", {
      class: "zsu-view" + (calm || first ? "" : dir === "back" ? " zsv-in-back"
                                          : dir === "fwd" ? " zsv-in-fwd" : " zsv-in-fade"),
    });

    try {
      if (this.view === "lock") this._view_lock(view);
      else if (this.view === "home") this._view_home(view);
      else {
        const fn = this[`_app_${this.appId}`];
        if (typeof fn === "function") fn.call(this, view);
        else this._view_home(view);
      }
    } catch (e) {
      console.error(`${M} | render failed for ${this.view}/${this.appId}`, e);
      view.appendChild(el("div", { class: "zs-empty", text: "This screen failed to draw." }));
    }

    /*
     * Only the *last* child is the view the player is looking at — new views are
     * appended. Anything before it is a leftover from a transition the next
     * navigation interrupted, and this used to read `firstElementChild`: a
     * second move inside the 400ms transition window re-animated the view that
     * was already leaving, and the one in between was never given an out class
     * and never scheduled for removal. It stayed on the stage forever, stacked
     * under the live view — two screens' worth of text on top of each other.
     * Retire the leftovers outright and animate only what is genuinely leaving.
     */
    const kids = [...this.stage.children];
    const old = kids.pop() ?? null;
    for (const stale of kids) stale.remove();

    if (old && !calm && !first) {
      old.classList.add(dir === "back" ? "zsv-out-back" : dir === "fwd" ? "zsv-out-fwd" : "zsv-out-fade");
      // `animationend` bubbles, so a child finishing an animation of its own
      // would otherwise pull the whole outgoing view out from under itself.
      old.addEventListener("animationend", e => { if (e.target === old) old.remove(); });
      // Belt and braces: if the animation never fires (tab backgrounded, motion
      // overridden mid-flight) the old view would otherwise sit there forever.
      setTimeout(() => old.remove(), 400);
    } else if (old) {
      old.remove();
    }

    this.stage.appendChild(view);
    this._restoreState(memo, view);
  }

  _captureState() {
    const memo = { field: null, value: "", start: 0, end: 0, scrolls: {} };
    if (!this.stage) return memo;

    const a = document.activeElement;
    if (a?.dataset?.zsField && this.stage.contains(a)) {
      memo.field = a.dataset.zsField;
      memo.value = a.value ?? "";
      memo.start = a.selectionStart ?? 0;
      memo.end = a.selectionEnd ?? 0;
    }
    for (const s of this.stage.querySelectorAll("[data-zs-scroll]")) {
      memo.scrolls[s.dataset.zsScroll] = s.scrollTop;
    }
    return memo;
  }

  _restoreState(memo, view) {
    for (const [key, top] of Object.entries(memo.scrolls)) {
      const s = view.querySelector(`[data-zs-scroll="${CSS.escape(key)}"]`);
      if (s) s.scrollTop = top;
    }
    if (!memo.field) return;
    const f = view.querySelector(`[data-zs-field="${CSS.escape(memo.field)}"]`);
    if (!f) return;
    // The stored value wins: it is what the player typed, and it may not have
    // reached the flags yet when an unrelated update triggered this repaint.
    if (memo.value) f.value = memo.value;
    f.focus();
    try { f.setSelectionRange(memo.start, memo.end); } catch (e) { /* not a text field */ }
  }

  /**
   * Turn motion suppression on or off on a live projection.
   *
   * Switching it *on* mid-transition has to settle the stage by hand. `.zs-calm`
   * cancels the animations outright, so a view already carrying `zsv-out-*`
   * never fires `animationend` and never reaches its `to { opacity: 0 }` — it
   * simply froze at full opacity on top of the view that had replaced it until
   * the 400ms backstop caught up. Reaching for the toggle to calm the interface
   * down was the one gesture guaranteed to make it overlap.
   */
  setCalm(calm) {
    if (!this.el) return;
    this.el.classList.toggle("zs-calm", calm);
    if (!calm || !this.stage) return;

    const kids = [...this.stage.children];
    const live = kids.pop() ?? null;
    for (const stale of kids) stale.remove();
    live?.classList.remove("zsv-in-fwd", "zsv-in-back", "zsv-in-fade",
                           "zsv-out-fwd", "zsv-out-back", "zsv-out-fade");
  }

  /** Retint the projection to the student's current accent, without a rebuild. */
  applyAccent() {
    if (!this.el) return;
    const acc = accentInfo(loadSection(this.actor, F.prefs).accent);
    this.el.style.setProperty("--zd-accent", acc.hue);
    this.el.style.setProperty("--zd-accent-deep", acc.deep);
    this.el.style.setProperty("--zd-accent-bright", acc.bright);
    app.icon?.applyAccent(this.actor);
  }

  /** Update the parts of the frame that live outside the stage. */
  _syncChrome() {
    if (!this.el) return;
    const dock = this.el.querySelector(".zsu-dock");
    if (dock) dock.replaceWith(this._dock());
  }

  /**
   * Keep the lock screen's clock honest.
   *
   * It used to drive the status bar too; with the bar gone the lock screen is
   * the only clock left, which is why it is now the large one and why dropping
   * the small duplicate cost nothing.
   */
  _startClock() {
    this._stopClock();
    this._clock = setInterval(() => {
      const c = this.el?.querySelector(".zsl-clock");
      if (c) c.textContent = getClock();
    }, 20_000);
  }

  _stopClock() {
    if (this._clock) clearInterval(this._clock);
    this._clock = null;
  }

  /** Escape steps back; the device should never be a keyboard trap. */
  _bindKeys() {
    if (this._keyHandler) document.removeEventListener("keydown", this._keyHandler);
    this._keyHandler = e => {
      if (!this.open_) return;
      if (e.key !== "Escape") return;
      // Let the lightbox close itself first.
      if (document.getElementById("zs-lightbox")) return;
      e.preventDefault();
      e.stopPropagation();
      this.back();
    };
    document.addEventListener("keydown", this._keyHandler);
  }

  // -------------------------------------------------------------------------
  //  Floating tooltip
  // -------------------------------------------------------------------------

  /**
   * Show a tooltip anchored to an element, parented to <body>.
   *
   * The contact tooltips used to be children of the circle they belonged to,
   * positioned at `bottom: calc(100% + 8px)` — escaping upward out of the
   * circle and straight into `.zsu-scroller`, which clips on both axes. The top
   * row of every category lost its tooltip to the top edge and the outer columns
   * lost theirs sideways.
   *
   * Nothing positioned inside a scroller can be relied on to escape it, so this
   * does not try: one reusable node lives on <body> at `position: fixed`, placed
   * from the anchor's own rect. No ancestor can clip it, and it flips below the
   * anchor when there is no room above.
   */
  _showTip(anchor, html) {
    if (!anchor?.getBoundingClientRect) return;
    this._hideTip();

    const tip = el("div", { class: "zsu-tip", role: "tooltip", html });
    document.body.appendChild(tip);
    this._tip = tip;

    let r, t;
    try { r = anchor.getBoundingClientRect(); t = tip.getBoundingClientRect(); }
    catch (e) { return; }   // headless; the node is built, just not placed
    if (!t.width && !t.height) return;

    const GAP = 8, EDGE = 8;
    const above = r.top - t.height - GAP;
    const below = r.bottom + GAP;
    const flip = above < EDGE;

    tip.style.top = (flip ? below : above) + "px";
    tip.classList.add(flip ? "zsu-tip-below" : "zsu-tip-above");

    // Clamp horizontally so a circle in the outer column doesn't push the
    // tooltip off the viewport the way it used to push it out of the scroller.
    const wide = window.innerWidth || 1600;
    let left = r.left + r.width / 2 - t.width / 2;
    left = Math.max(EDGE, Math.min(left, wide - t.width - EDGE));
    tip.style.left = left + "px";
  }

  _hideTip() {
    this._tip?.remove();
    this._tip = null;
  }

  // -------------------------------------------------------------------------
  //  Dock
  // -------------------------------------------------------------------------

  _dock() {
    const dock = el("div", { class: "zsu-dock", role: "navigation", "aria-label": "Device navigation" });
    if (this.view === "lock") { dock.classList.add("zsd-hidden"); return dock; }

    const unread = totalUnread(this.actor);
    const notices = unreadNotices(this.actor);

    const mk = (id, icon, label, count, active) => {
      const b = btn(
        "zsd-btn" + (active ? " active" : ""),
        count ? `${label}, ${count} new` : label,
        () => {
          if (id === "home") this.go("home", null, this.view === "app" ? "back" : "fwd");
          else this.go("app", id, "fwd");
        },
        { html: `<i class="fa-solid ${icon}" aria-hidden="true"></i>` +
                (count ? `<span class="zsd-badge">${count > 9 ? "9+" : count}</span>` : "") },
      );
      if (active) b.setAttribute("aria-current", "page");
      return b;
    };

    dock.appendChild(mk("home", "fa-table-cells-large", "Home", 0, this.view === "home"));
    for (const a of APPS.filter(x => x.dock)) {
      const count = a.id === "messages" ? unread : a.id === "notices" ? notices : 0;
      dock.appendChild(mk(a.id, a.icon, a.label, count,
        this.view === "app" && this.appId === a.id));
    }
    return dock;
  }

  /**
   * Standard app header: back chevron, title, optional trailing control.
   *
   * Three cells, and the two outer ones are equal `1fr` — which is what actually
   * centres the title. The old flex version balanced a 30px back button against
   * a 30px spacer, so it was only centred while the trailing control happened to
   * be exactly 30px wide; the Messages thread header, which swaps the title for
   * an avatar block and adds a mute button, was visibly off.
   *
   * The trailing cell also carries a spacer the width of the close button, which
   * now floats over the bar's right end. Because the side cells are sized by the
   * grid rather than their contents, that spacer does not pull the title off
   * centre — it only keeps the trailing control out from under the close.
   */
  _appBar(ct, title, trailing = null) {
    const bar = el("div", { class: "zsu-appbar" });

    bar.appendChild(btn("zsu-back", "Back", () => this.back(),
      { html: '<i class="fa-solid fa-chevron-left" aria-hidden="true"></i>' }));
    bar.appendChild(el("h2", { class: "zsu-apptitle", text: title }));

    const tail = el("div", { class: "zsu-aptail" });
    if (trailing) tail.appendChild(trailing);
    tail.appendChild(el("div", { class: "zsu-apbspacer", "aria-hidden": "true" }));
    bar.appendChild(tail);

    ct.appendChild(bar);
    return bar;
  }

  /** A scroll region whose offset survives a repaint. */
  _scroller(key) {
    return el("div", { class: "zsu-scroller", "data-zs-scroll": key });
  }

  // =========================================================================
  //  LOCK SCREEN
  // =========================================================================

  _view_lock(ct) {
    const d = loadAll(this.actor);
    const ev = nextEvent();
    const unread = totalUnread(this.actor);
    const notices = unreadNotices(this.actor);
    const date = getAutoDate();
    const name = d.prefs.deviceName || `${this.actor.name.split(" ")[0]}'s Scroll`;

    const lock = el("div", { class: "zsl-wrap" });

    lock.appendChild(el("div", { class: "zsl-device", text: name }));
    lock.appendChild(el("div", { class: "zsl-clock", text: getClock() }));
    if (date) lock.appendChild(el("div", { class: "zsl-date", text: date }));

    lock.appendChild(el("div", { class: "zsl-rule", "aria-hidden": "true" }));

    if (ev) {
      const e = el("div", { class: "zsl-event" });
      e.innerHTML =
        `<div class="zsl-evlabel">NEXT</div>` +
        `<div class="zsl-evname">${esc(ev.name)}</div>` +
        `<div class="zsl-evdays">${esc(daysLabel(ev.days))}</div>`;
      lock.appendChild(e);
    }

    const pills = el("div", { class: "zsl-pills" });
    if (unread) {
      pills.appendChild(el("div", {
        class: "zsl-pill",
        html: `<i class="fa-solid fa-comment-dots" aria-hidden="true"></i> ${unread} message${unread === 1 ? "" : "s"}`,
      }));
    }
    if (notices) {
      pills.appendChild(el("div", {
        class: "zsl-pill",
        html: `<i class="fa-solid fa-bullhorn" aria-hidden="true"></i> ${notices} notice${notices === 1 ? "" : "s"}`,
      }));
    }
    if (pills.children.length) lock.appendChild(pills);

    // The whole lock screen is one big button, so Enter and Space unlock it too.
    const open = btn("zsl-open", "Unlock the scroll", () => this.go("home", null, "fwd"), {
      html: `<span class="zsl-openglow" aria-hidden="true"></span>` +
            `<span class="zsl-opentext">Touch the stone</span>`,
    });
    lock.appendChild(open);

    ct.appendChild(lock);
    setTimeout(() => open.focus({ preventScroll: true }), 40);
  }

  // =========================================================================
  //  HOME  —  app grid
  // =========================================================================

  _view_home(ct) {
    const d = loadAll(this.actor);
    const unread = totalUnread(this.actor);
    const notices = unreadNotices(this.actor);

    const unseen = unseenNotifications(this.actor);

    const head = el("div", { class: "zsn-head" });
    head.innerHTML =
      `<div class="zsn-pic"><img src="${esc(portraitOf(this.actor) ?? "")}" alt=""/></div>` +
      `<div class="zsn-who"><div class="zsn-name">${esc(this.actor.name)}</div>` +
      `<div class="zsn-sub">${esc(d.cohort || yearLabel(d.year))}</div></div>`;

    // The bell that used to live in the status bar. Alerts is a full app in the
    // grid now, but the badge needs to be visible the moment you unlock rather
    // than something you have to go looking for among ten tiles.
    head.appendChild(btn(
      "zsn-bell" + (unseen ? " has" : ""),
      unseen ? `Alerts, ${unseen} unread` : "Alerts",
      () => this.go("app", "alerts", "fwd"),
      { html: `<i class="fa-solid fa-bell" aria-hidden="true"></i>` +
              (unseen ? `<span class="zsn-belldot" aria-hidden="true"></span>` : "") },
    ));
    ct.appendChild(head);

    if (d.status) {
      ct.appendChild(el("div", {
        class: "zsn-status",
        html: `<i class="fa-solid fa-quote-left" aria-hidden="true"></i> ${esc(d.status)}`,
      }));
    }

    const scroller = this._scroller("home");
    const grid = el("div", { class: "zsn-grid", role: "list" });

    for (const a of APPS) {
      const count = a.id === "messages" ? unread
                  : a.id === "notices"  ? notices
                  : a.id === "alerts"   ? unseen : 0;
      const cell = btn("zsn-app", count ? `${a.label}, ${count} new` : a.label,
        () => this.go("app", a.id, "fwd"));
      cell.setAttribute("role", "listitem");
      cell.innerHTML =
        `<span class="zsn-tile"><i class="fa-solid ${a.icon}" aria-hidden="true"></i>` +
        (count ? `<span class="zsn-badge">${count > 9 ? "9+" : count}</span>` : "") +
        `</span><span class="zsn-label">${esc(a.label)}</span>`;
      grid.appendChild(cell);
    }

    scroller.appendChild(grid);
    ct.appendChild(scroller);
  }

  // =========================================================================
  //  APP — STUDENT ID
  // =========================================================================

  _app_profile(ct) {
    const d = loadAll(this.actor);
    const cur = primaryCurrency();
    const balance = getCurrency(this.actor, cur.key);
    const ev = nextEvent();

    this._appBar(ct, "Student ID");
    const s = this._scroller("profile");

    const card = el("div", { class: "zsh-card" });
    card.innerHTML =
      `<div class="zsh-cardglow" aria-hidden="true"></div>` +
      `<div class="zsh-portrait"><img src="${esc(portraitOf(this.actor) ?? "")}" alt="Portrait of ${esc(this.actor.name)}"/></div>` +
      `<div class="zsh-info">` +
        `<div class="zsh-name">${esc(this.actor.name)}</div>` +
        (d.cohort ? `<div class="zsh-cohort">${esc(d.cohort)}</div>` : "") +
        `<div class="zsh-id">${esc(d.studentId)}</div>` +
      `</div>`;
    s.appendChild(card);

    // --- editable status line ---
    const statusRow = el("div", { class: "zsh-status" });
    const setView = () => {
      statusRow.replaceChildren(btn("zsh-statbtn", "Set your status",
        () => this._editStatus(statusRow, setView),
        { html: d.status
            ? `<span class="zsh-stxt">${esc(d.status)}</span>`
            : `<span class="zsh-stxt zsh-stph">Tap to set status…</span>` }));
    };
    setView();
    s.appendChild(statusRow);

    // --- stats ---
    const stats = el("div", { class: "zsh-stats" });
    // The currency stat follows whichever currency is marked primary, because
    // there is only room for one figure here and a world that runs on Astras
    // should not be told about Marks.
    stats.innerHTML =
      `<div class="zsh-stat"><div class="zsh-sl">YEAR</div><div class="zsh-sv">${esc(yearLabel(d.year))}</div></div>` +
      `<div class="zsh-stat"><div class="zsh-sl">${esc(cur.label.toUpperCase())}</div>` +
        `<div class="zsh-sv zsh-gold">${balance}</div></div>` +
      `<div class="zsh-stat"><div class="zsh-sl">GIFT</div><div class="zsh-sv zsh-sm">${esc(d.gift) || "—"}</div></div>`;
    s.appendChild(stats);

    if (ev) {
      const e = el("div", { class: "zsh-event" });
      e.innerHTML =
        `<div class="zsh-evlabel">NEXT EVENT</div>` +
        `<div class="zsh-evname">${esc(ev.name)}</div>` +
        `<div class="zsh-evdays">${esc(daysLabel(ev.days))}</div>`;
      s.appendChild(e);
    }

    if (d.dormitory) {
      s.appendChild(el("div", {
        class: "zsh-detail",
        html: `<span class="zsh-dl">DORMITORY</span><span>${esc(d.dormitory)}</span>`,
      }));
    }

    // d.notes is GM-authored and may intentionally contain HTML, so it is not escaped
    if (d.notes) s.appendChild(el("div", { class: "zsh-notes", html: d.notes }));

    ct.appendChild(s);
  }

  _editStatus(row, restore) {
    if (row.querySelector(".zsh-statinput")) return;   // already editing
    const current = loadSection(this.actor, F.profile).status || "";

    const inp = el("input", {
      class: "zsh-statinput", type: "text", value: current,
      "data-zs-field": "status", "aria-label": "Your status",
      placeholder: "What's on your mind?", maxlength: "80",
    });
    row.replaceChildren(inp);
    inp.focus();

    let done = false;
    const save = async () => {
      if (done) return;   // Enter also triggers blur; only write once
      done = true;
      const p = loadSection(this.actor, F.profile);
      p.status = inp.value.trim();
      await saveSection(this.actor, F.profile, p);
      this._paint(null);
    };

    inp.addEventListener("blur", save);
    inp.addEventListener("keydown", e => {
      if (e.key === "Enter") save();
      if (e.key === "Escape") { done = true; restore(); e.stopPropagation(); }
    });
  }

  // =========================================================================
  //  APP — SCHEDULE
  // =========================================================================

  _app_schedule(ct) {
    const d = loadAll(this.actor);
    this._appBar(ct, "Schedule");
    const s = this._scroller("schedule");

    const rows = (d.schedule || []).filter(x => x.course);
    if (!rows.length) {
      s.appendChild(el("div", { class: "zs-empty", text: "No classes scheduled." }));
    } else {
      for (const r of rows) {
        s.appendChild(el("div", {
          class: "zss-row",
          html: `<div class="zss-period">${esc(r.period)}</div>` +
                `<div class="zss-info"><div class="zss-course">${esc(r.course)}</div>` +
                `<div class="zss-meta">${esc(r.instructor)}${r.location ? " · " + esc(r.location) : ""}</div></div>`,
        }));
      }
    }
    ct.appendChild(s);
  }

  // =========================================================================
  //  APP — GIFT
  // =========================================================================

  /**
   * The Gift.
   *
   * Two different screens behind one app. A student who is on a tree gets the
   * tree; one who is not gets the v1.8 milestone track, which is still the
   * right answer for a campaign that never builds a tree at all.
   */
  _app_gift(ct) {
    const graph = resolveGiftTree(this.actor);
    if (graph.nodes.length) return this._app_giftTree(ct, graph);

    const d = loadAll(this.actor);
    this._appBar(ct, "Gift");
    const s = this._scroller("gift");

    if (!d.gift) {
      s.appendChild(el("div", { class: "zs-empty", text: "No Gift data." }));
      ct.appendChild(s);
      return;
    }

    const head = el("div", { class: "zsg-head" });
    head.innerHTML =
      `<div class="zsg-name">${esc(d.gift)}</div>` +
      `<div class="zsg-lvl">Lv${Number(d.giftLevel) || 1}</div>`;
    s.appendChild(head);

    // giftDescription is GM-authored long-form and may intentionally contain
    // HTML (as with academic.notes), so it stays unescaped.
    if (d.giftDescription) s.appendChild(el("div", { class: "zsg-desc", html: d.giftDescription }));

    const ms = d.giftMilestones || [];
    if (ms.length) {
      s.appendChild(el("div", { class: "zsg-mslabel", text: "PROGRESSION" }));
      const done = ms.filter(m => m.achieved).length;
      const track = el("div", { class: "zsg-track" });
      track.innerHTML = `<span class="zsg-fill" style="width:${Math.round(done / ms.length * 100)}%"></span>`;
      s.appendChild(track);
      s.appendChild(el("div", { class: "zsg-count", text: `${done} of ${ms.length} reached` }));

      for (const m of ms) {
        s.appendChild(el("div", {
          class: "zsg-ms" + (m.achieved ? " done" : ""),
          html: `<span class="zsg-dot" aria-hidden="true">${m.achieved ? "◆" : "◇"}</span>` +
                `<span>${esc(m.name)}</span>`,
        }));
      }
    }
    ct.appendChild(s);
  }

  // -------------------------------------------------------------------------
  //  The tree
  // -------------------------------------------------------------------------

  /**
   * Where to look when the app opens.
   *
   * The frontier — what they can afford right now — rather than the root they
   * took six sessions ago. A tree is opened to decide something, and the thing
   * to decide is always at the edge of what has been taken.
   *
   * Falls back to what they have taken, and then to the whole tree, so a
   * student with nothing affordable and nothing taken still opens somewhere
   * sensible rather than at 0,0.
   */
  _giftFocus(graph) {
    const pick = [
      graph.nodes.filter(n => !n.taken && giftNodeState(graph, n) === "affordable"),
      graph.nodes.filter(n => n.taken),
      graph.nodes,
    ].find(set => set.length) ?? [];

    if (!pick.length) return { x: 50, y: 50 };
    return {
      x: pick.reduce((t, n) => t + n.x, 0) / pick.length,
      y: pick.reduce((t, n) => t + n.y, 0) / pick.length,
    };
  }

  _app_giftTree(ct, graph) {
    const d = loadAll(this.actor);

    const recentre = btn("zsg-recentre", "Recentre the tree", () => {
      this.giftView = null;
      this.refresh();
    }, { html: '<i class="fa-solid fa-crosshairs" aria-hidden="true"></i>' });

    this._appBar(ct, "Gift", recentre);

    // --- what they are and what they have to spend ---
    const head = el("div", { class: "zsg-thead" });
    head.innerHTML =
      `<div class="zsg-tname">${esc(d.gift || "Your Gift")}</div>` +
      `<div class="zsg-pts${graph.points ? " has" : ""}">` +
        `<span class="zsg-ptn">${graph.points}</span>` +
        `<span class="zsg-ptl">point${graph.points === 1 ? "" : "s"} to spend</span>` +
      `</div>`;
    ct.appendChild(head);

    ct.appendChild(this._giftBoard(graph));

    if (this.giftNode) {
      const node = graph.byId.get(this.giftNode);
      if (node) ct.appendChild(this._giftSheet(graph, node));
      else this.giftNode = null;
    }
  }

  /**
   * The board: pan by dragging, zoom by wheel or the two buttons.
   *
   * Pinch is deliberately not wired. It needs two-pointer tracking, and the
   * device is overwhelmingly used on a desktop Foundry client where the wheel
   * already does the job — a half-built pinch that fights the drag handler
   * would be worse than none.
   */
  _giftBoard(graph) {
    const wrap = el("div", { class: "zsg-boardwrap" });
    const board = el("div", { class: "zsg-board" });

    if (!this.giftView) {
      const f = this._giftFocus(graph);
      // Centre the focus point: the plane is the size of the viewport, so
      // putting a point at the middle means shifting it by the difference
      // between the middle and where it sits, as a fraction of the plane.
      this.giftView = { x: 50 - f.x, y: 50 - f.y, z: 1 };
    }
    const view = this.giftView;

    // The same inset trick the editor board uses: a node is centred on its own
    // coordinate and is wider than it is tall, so 0% and 100% would put half of
    // it outside a pane that has to clip.
    const plane = el("div", { class: "zsg-plane" });
    const applyView = () => {
      plane.style.transform =
        `translate(${view.x}%, ${view.y}%) scale(${view.z})`;
    };
    applyView();

    // --- edges ---
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "zsg-edges");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("preserveAspectRatio", "none");
    for (const n of graph.nodes) {
      for (const r of n.requires) {
        const from = graph.byId.get(r);
        if (!from) continue;   // a prerequisite in a tree they are not on
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", from.x);
        line.setAttribute("y1", from.y);
        line.setAttribute("x2", n.x);
        line.setAttribute("y2", n.y);
        // Lit only when both ends are taken, so a finished path reads as a path
        // rather than as a diagram of one.
        line.setAttribute("class", "zsg-edge" + (from.taken && n.taken ? " lit" : ""));
        svg.appendChild(line);
      }
    }
    plane.appendChild(svg);

    // --- nodes ---
    for (const n of graph.nodes) {
      const state = giftNodeState(graph, n);
      const label = n.name || "Unnamed";
      const why = {
        taken: "taken",
        affordable: `costs ${n.cost}, you can take this`,
        "locked-cost": `costs ${n.cost}, you have ${graph.points}`,
        "locked-req": "locked until what it needs is taken",
      }[state];

      const node = btn(`zsg-node k-${n.kind} s-${state}` + (this.giftNode === n.id ? " open" : ""),
        `${label} — ${why}`,
        () => { this.giftNode = n.id; this.refresh(); });
      node.style.left = `${n.x}%`;
      node.style.top = `${n.y}%`;
      node.appendChild(el("span", { class: "zsg-nlabel", text: label }));
      if (!n.taken && n.cost) node.appendChild(el("span", { class: "zsg-ncost", text: String(n.cost) }));
      if (n.taken) node.appendChild(el("i", { class: "fa-solid fa-check zsg-ntick", "aria-hidden": "true" }));
      plane.appendChild(node);
    }

    board.appendChild(plane);

    /*
     * Pan.
     *
     * Pointer events rather than mouse, so a tablet drags as well as a mouse,
     * and capture so a drag that leaves the board still ends properly instead
     * of leaving the board stuck to the cursor.
     */
    let from = null;
    board.addEventListener("pointerdown", ev => {
      if (ev.target.closest(".zsg-node")) return;
      from = { px: ev.clientX, py: ev.clientY, x: view.x, y: view.y };
      board.setPointerCapture?.(ev.pointerId);
      board.classList.add("dragging");
    });
    board.addEventListener("pointermove", ev => {
      if (!from) return;
      const r = board.getBoundingClientRect();
      if (!r.width || !r.height) return;
      view.x = from.x + ((ev.clientX - from.px) / r.width) * 100;
      view.y = from.y + ((ev.clientY - from.py) / r.height) * 100;
      applyView();
    });
    const end = ev => {
      if (!from) return;
      from = null;
      board.releasePointerCapture?.(ev.pointerId);
      board.classList.remove("dragging");
    };
    board.addEventListener("pointerup", end);
    board.addEventListener("pointercancel", end);

    board.addEventListener("wheel", ev => {
      ev.preventDefault();
      view.z = Math.min(2.2, Math.max(0.45, view.z * (ev.deltaY < 0 ? 1.12 : 1 / 1.12)));
      applyView();
    }, { passive: false });

    wrap.appendChild(board);

    // Explicit zoom, because a wheel is not the only way people use this and a
    // trackpad in a Foundry window is often already spoken for.
    const zoom = el("div", { class: "zsg-zoom" });
    const step = f => {
      view.z = Math.min(2.2, Math.max(0.45, view.z * f));
      applyView();
    };
    zoom.appendChild(btn("zsg-zbtn", "Zoom in", () => step(1.2), { html: '<i class="fa-solid fa-plus"></i>' }));
    zoom.appendChild(btn("zsg-zbtn", "Zoom out", () => step(1 / 1.2), { html: '<i class="fa-solid fa-minus"></i>' }));
    wrap.appendChild(zoom);

    return wrap;
  }

  /**
   * One node, up close.
   *
   * A sheet over the board rather than a separate screen: the decision is about
   * where the node sits in the tree, and taking the tree away to describe one
   * node throws that away.
   */
  _giftSheet(graph, node) {
    const state = giftNodeState(graph, node);
    const sheet = el("div", { class: `zsg-sheet s-${state}` });

    const bar = el("div", { class: "zsg-shead" });
    bar.appendChild(el("div", { class: "zsg-skind", text: node.kind }));
    bar.appendChild(el("div", { class: "zsg-sname", text: node.name || "Unnamed" }));
    bar.appendChild(btn("zsg-sclose", "Close", () => { this.giftNode = null; this.refresh(); },
      { html: "×" }));
    sheet.appendChild(bar);

    const body = el("div", { class: "zsg-sbody" });

    if (node.description) body.appendChild(el("div", { class: "zsg-sdesc", text: node.description }));
    if (node.effect) {
      body.appendChild(el("div", { class: "zsg-slabel", text: "EFFECT" }));
      body.appendChild(el("div", { class: "zsg-seffect", text: node.effect }));
    }

    if (node.grants?.length) {
      body.appendChild(el("div", { class: "zsg-slabel", text: "GRANTS" }));
      for (const g of node.grants) {
        const row = el("div", { class: "zsg-sgrant" });
        if (g.img) row.appendChild(el("img", { class: "zsg-gimg", src: g.img, alt: "" }));
        row.appendChild(el("span", { text: g.name || "An ability" }));
        body.appendChild(row);
      }
    }

    // What it needs, named rather than implied — "locked" without saying by
    // what is the most annoying thing a skill tree can do.
    const missing = node.requires
      .map(r => graph.byId.get(r))
      .filter(dep => dep && !dep.taken);
    if (missing.length) {
      body.appendChild(el("div", { class: "zsg-slabel", text: "NEEDS FIRST" }));
      body.appendChild(el("div", {
        class: "zsg-sneeds",
        text: missing.map(m => m.name || "an earlier node").join(", "),
      }));
    }

    sheet.appendChild(body);

    // --- the decision ---
    const foot = el("div", { class: "zsg-sfoot" });
    if (node.taken) {
      foot.appendChild(el("div", { class: "zsg-stag", text: "✓ Taken" }));
    } else if (state === "affordable") {
      foot.appendChild(el("div", { class: "zsg-scost", text: `${node.cost} point${node.cost === 1 ? "" : "s"}` }));
      foot.appendChild(btn("zsg-take", `Take ${node.name || "this node"}`, async () => {
        if (!await confirmDialog("Take this?",
          `<p>Spend <b>${esc(String(node.cost))}</b> point(s) on <b>${esc(node.name || "this node")}</b>?</p>`
          + (node.grants?.length
            ? `<p>It grants: ${esc(node.grants.map(g => g.name || "an ability").join(", "))}.</p>`
            : ""))) return;

        const res = await unlockGiftNode(this.actor, node.id);
        if (!res.ok) return ui.notifications.warn(res.why);
        app.icon?.pulse();
        this.refresh();
      }, { html: '<i class="fa-solid fa-unlock" aria-hidden="true"></i> Take it' }));
    } else {
      foot.appendChild(el("div", {
        class: "zsg-stag locked",
        text: state === "locked-cost"
          ? `${node.cost} points — you have ${graph.points}`
          : "Locked",
      }));
    }
    sheet.appendChild(foot);

    return sheet;
  }

  // =========================================================================
  //  APP — NOTICES  (world announcements)
  // =========================================================================

  _app_notices(ct) {
    this._appBar(ct, "Notices");
    const s = this._scroller("notices");

    const anns = announcementsFor(this.actor);
    if (!anns.length) {
      s.appendChild(el("div", { class: "zs-empty", text: "The board is clear." }));
      ct.appendChild(s);
      return;
    }

    // Pinned notices float to the top; the rest keep the GM's authored order.
    const sorted = [...anns].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

    for (const a of sorted) {
      const card = el("div", { class: "zsb-notice" + (a.pinned ? " pinned" : "") });
      card.innerHTML =
        `<div class="zsb-nhead"><i class="fa-solid ${a.pinned ? "fa-thumbtack" : "fa-bullhorn"}" aria-hidden="true"></i>` +
        `<span class="zsb-ntime">${esc(a.time || "")}</span></div>` +
        `<div class="zsb-nbody">${esc(a.text)}</div>`;
      card.appendChild(btn("zsb-ndismiss", "Dismiss this notice", async () => {
        if (!await confirmDialog("Dismiss Notice", "Dismiss this notice?")) return;
        const sys = loadSection(this.actor, F.system);
        if (!Array.isArray(sys.dismissedAnnouncements)) sys.dismissedAnnouncements = [];
        sys.dismissedAnnouncements.push(a.key);
        await saveSection(this.actor, F.system, sys);
        this._syncChrome();
        this._paint(null);
      }, { html: '<i class="fa-solid fa-xmark" aria-hidden="true"></i>' }));
      s.appendChild(card);
    }
    ct.appendChild(s);
  }

  // =========================================================================
  //  APP — MESSAGES
  // =========================================================================

  _app_messages(ct) {
    if (this.convId) { this._convThread(ct); return; }

    const d = loadAll(this.actor);
    const social = loadSection(this.actor, F.social);
    const convs = social.conversations || [];

    const newBtn = msgEnabled()
      ? btn("zsu-apbtn", "New conversation", () => this._newConvPicker(ct),
          { html: '<i class="fa-solid fa-pen-to-square" aria-hidden="true"></i>' })
      : null;
    this._appBar(ct, "Messages", newBtn);

    const s = this._scroller("messages");

    // The aether meter used to live in the status bar and read "full" when a GM
    // was connected. The bar is gone; the one state worth surfacing is the one
    // that stops a message being deliverable, and this is the screen where that
    // matters. Shown only when it is true.
    if (msgEnabled() && !gmOnline()) {
      s.appendChild(el("div", {
        class: "zsm-aether", role: "status",
        html: `<i class="fa-solid fa-tower-broadcast" aria-hidden="true"></i>` +
              `<span>No aether link. Messages to other students cannot be sent right now.</span>`,
      }));
    }

    if (!convs.length) {
      s.appendChild(el("div", { class: "zs-empty", text: "No conversations yet." }));
      ct.appendChild(s);
      return;
    }

    // Sort by last message time, most recent first. Messages written before
    // v1.6 carry no ts, so those threads fall back to reverse creation order
    // and self-heal as they get used.
    const lastTs = c => c.messages?.[c.messages.length - 1]?.ts ?? 0;
    const order = new Map(convs.map((c, i) => [c.id, i]));
    const sorted = [...convs].sort((a, b) =>
      (lastTs(b) - lastTs(a)) || ((order.get(b.id) ?? 0) - (order.get(a.id) ?? 0)));

    const myName = this.actor.name;
    for (const conv of sorted) {
      const lastMsg = conv.messages?.[conv.messages.length - 1];
      const unread = (conv.messages || []).filter(m => !m.read && !m.sent).length;

      // 1-on-1 threads always show the other person, whoever sent last
      const displayName = conv.isGroup
        ? (conv.title || conv.participants.filter(n => n !== myName).join(", "))
        : conv.participants.find(n => n !== myName) || "Unknown";

      const portrait = findPortrait(displayName, d.relationships);
      const lastText = lastMsg?.text || (lastMsg?.image ? "Image" : "");
      const preview = lastMsg
        ? (lastText.length > 46 ? lastText.slice(0, 46) + "…" : lastText)
        : "No messages yet";

      const row = btn("zsm-thread" + (unread ? " unread" : ""), `Conversation with ${displayName}`,
        () => { this.convId = conv.id; this._paint("fwd"); });

      if (portrait) row.appendChild(el("img", { class: "zsm-tavatar", src: portrait, alt: "" }));
      else row.appendChild(el("div", {
        class: "zsm-tavatar-ph", "aria-hidden": "true",
        html: conv.isGroup ? '<i class="fa-solid fa-users"></i>' : '<i class="fa-solid fa-user"></i>',
      }));

      const info = el("div", { class: "zsm-tinfo" });
      info.innerHTML =
        `<div class="zsm-tname">${esc(displayName)}` +
        (conv.muted ? ` <i class="fa-solid fa-bell-slash zsm-tmute" aria-hidden="true"></i>` : "") +
        `</div>` +
        `<div class="zsm-tpreview">${lastMsg?.sent ? "You: " : ""}${esc(preview)}</div>`;
      row.appendChild(info);

      const meta = el("div", { class: "zsm-tmeta" });
      if (lastMsg?.time) meta.appendChild(el("div", { class: "zsm-ttime", text: lastMsg.time }));
      if (unread) meta.appendChild(el("div", { class: "zsm-tunread", text: String(unread) }));
      row.appendChild(meta);

      s.appendChild(row);
    }
    ct.appendChild(s);
  }

  _convThread(ct) {
    const d = loadAll(this.actor);
    const social = loadSection(this.actor, F.social);
    const conv = social.conversations.find(c => c.id === this.convId);
    if (!conv) { this.convId = null; this._app_messages(ct); return; }

    const myName = this.actor.name;
    const displayName = conv.isGroup
      ? (conv.title || conv.participants.filter(n => n !== myName).join(", "))
      : conv.participants.find(n => n !== myName) || "Unknown";
    const portrait = findPortrait(displayName, d.relationships);

    // Mark inbound messages read. Silent, so it doesn't re-render the thread
    // we're in the middle of drawing.
    let changed = false;
    const marks = [];
    for (const m of conv.messages) {
      if (m.read || m.sent) continue;
      m.read = true;
      changed = true;
      // What the sender needs to hear about. Collected here rather than derived
      // later, because after the save every message in the thread reads as read.
      marks.push({ from: String(m.from ?? ""), ts: Number(m.ts) || 0 });
    }
    if (changed) {
      saveSection(this.actor, F.social, social, { silent: true })
        .then(() => {
          app.icon?.updateBadge(this.actor);
          this._syncChrome();
          if (gmOnline()) emitReadReceipt(conv.id, marks, this.actor.name);
        });
    }

    // --- header, with the mute toggle ---
    const muteBtn = btn("zsu-apbtn" + (conv.muted ? " on" : ""),
      conv.muted ? "Unmute this conversation" : "Mute this conversation",
      async () => {
        const fresh = loadSection(this.actor, F.social);
        const c = fresh.conversations.find(x => x.id === this.convId);
        if (!c) return;
        c.muted = !c.muted;
        await saveSection(this.actor, F.social, fresh, { silent: true });
        this._paint(null);
      },
      { html: `<i class="fa-solid ${conv.muted ? "fa-bell-slash" : "fa-bell"}" aria-hidden="true"></i>` });

    const bar = this._appBar(ct, displayName, muteBtn);
    // Swap the plain title for an avatar + subtitle block
    const title = bar.querySelector(".zsu-apptitle");
    if (title) {
      const hdr = el("div", { class: "zsm-thead" });
      if (portrait) hdr.appendChild(el("img", { class: "zsm-thimg", src: portrait, alt: "" }));
      const txt = el("div", { class: "zsm-thtext" });
      txt.appendChild(el("div", { class: "zsm-thname", text: displayName }));
      if (conv.isGroup) {
        txt.appendChild(el("div", { class: "zsm-thsub", text: conv.participants.length + " members" }));
      }
      hdr.appendChild(txt);
      title.replaceWith(hdr);
    }

    // --- messages, with day separators ---
    const list = el("div", { class: "zsm-msglist", "data-zs-scroll": "thread-" + conv.id });
    let lastDay = null;
    let lastFrom = null;

    for (const m of conv.messages) {
      const day = m.ts ? new Date(m.ts).toDateString() : null;
      if (day && day !== lastDay) {
        lastDay = day;
        lastFrom = null;
        list.appendChild(el("div", { class: "zsm-daysep", text: this._dayLabel(m.ts) }));
      }

      // In a group, only label a run of messages from the same person once.
      const showFrom = conv.isGroup && !m.sent && m.from !== lastFrom;
      lastFrom = m.sent ? null : m.from;

      const msg = el("div", { class: m.sent ? "zsm-msg zsm-sent" : "zsm-msg" });
      msg.innerHTML =
        (showFrom ? `<div class="zsm-mfrom">${esc(m.from)}</div>` : "") +
        (m.text ? `<div class="zsm-mbody">${esc(m.text)}</div>` : "") +
        (m.image ? `<img class="zsm-mimg" src="${esc(m.image)}" alt="Attached image" data-zs-lb="${esc(m.image)}"/>` : "") +
        `<div class="zsm-mtime">${esc(m.time || "")}${m.sent ? this._receipt(m, conv) : ""}</div>`;
      list.appendChild(msg);
    }
    ct.appendChild(list);

    // --- the image queued on the composer, if there is one ---
    if (this._attach) {
      const chip = el("div", { class: "zsm-attach" });
      chip.appendChild(el("img", { class: "zsm-attach-img", src: this._attach.src, alt: "" }));
      chip.appendChild(el("span", {
        class: "zsm-attach-cap", text: this._attach.caption || "Attached image",
      }));
      chip.appendChild(btn("zsm-attach-x", "Remove the attachment", () => {
        this._attach = null;
        this._paint(null);
      }, { html: '<i class="fa-solid fa-xmark" aria-hidden="true"></i>' }));
      ct.appendChild(chip);
    }

    // --- composer ---
    const reply = el("div", { class: "zsm-reply" });
    const inp = el("input", {
      class: "zsm-replyinput", type: "text",
      "data-zs-field": "reply-" + conv.id, "aria-label": `Message ${displayName}`,
      placeholder: "Type a message…", maxlength: "300",
    });

    const send = async () => {
      const txt = inp.value.trim();
      const attach = this._attach;
      if (!txt && !attach) return;

      // Reaching another *player* depends on a connected GM to relay. Check
      // that before writing anything locally, so a thread never shows a
      // message that never arrived. NPC replies need no relay — the GM reads
      // those in the Command Center.
      const otherNames = conv.participants.filter(n => n !== myName);
      const pcNames = new Set(game.users.filter(u => !u.isGM && u.character).map(u => u.character.name));
      if (otherNames.some(n => pcNames.has(n))) {
        if (!msgEnabled()) {
          ui.notifications.warn("Player-to-player messaging is turned off.");
          return;
        }
        if (!gmOnline()) {
          ui.notifications.warn("No aether link — no GM is connected, so your message was not sent.");
          return;
        }
      }

      const fresh = loadSection(this.actor, F.social);
      const target = fresh.conversations.find(c => c.id === this.convId);
      if (!target) return;

      const timeStr = getAutoTime() || "Now";
      const image = attach ? safeImageSrc(attach.src) : "";
      const msg = { from: myName, text: txt, time: timeStr, ts: Date.now(), image, read: true, sent: true };
      target.messages.push(msg);
      inp.value = "";
      this._attach = null;
      await saveSection(this.actor, F.social, fresh);

      const otherIds = otherNames.map(n => game.actors.getName(n)?.id).filter(Boolean);
      if (otherIds.length) {
        emitMessage(target.id, target.participants, target.title, target.isGroup,
          { from: myName, text: txt, time: timeStr, ts: msg.ts, image },
          otherIds, myName);
      }

      this._paint(null);
    };

    const sendBtn = btn("zsm-sendbtn", "Send", send,
      { html: '<i class="fa-solid fa-paper-plane" aria-hidden="true"></i>' });

    const clip = btn("zsm-clipbtn", "Attach an image from your gallery",
      () => this._attachPicker(ct),
      { html: '<i class="fa-solid fa-paperclip" aria-hidden="true"></i>' });

    inp.addEventListener("keydown", e => { if (e.key === "Enter") send(); });
    reply.append(clip, inp, sendBtn);
    ct.appendChild(reply);

    setTimeout(() => list.scrollTop = list.scrollHeight, 40);

    // An image someone sent you is worth keeping, so the lightbox on a message
    // offers the same download, and a way into your own gallery.
    ct.querySelectorAll("[data-zs-lb]").forEach(img => {
      const isrc = safeImageSrc(img.dataset.zsLb);
      if (!isrc) return;
      img.addEventListener("click", () => this._lightbox(isrc, "", [
        { icon: "fa-download", label: "Download", onClick: () => this._downloadImage(isrc, "") },
        {
          icon: "fa-images", label: "Save to gallery",
          onClick: async (lb, close) => {
            await addGalleryImage(this.actor, { src: isrc, caption: "", from: displayName });
            close();
            ui.notifications.info("Saved to your gallery.");
            this.refresh();
          },
        },
      ]));
    });
  }

  /**
   * Delivery ticks on a message you sent.
   *
   * One tick: written into their scroll. Two: they have opened the thread. In a
   * group the count is what matters, so it says how many of them have.
   *
   * Shown only on threads with another *student* in them. An NPC's scroll does
   * not exist, so it can never send a receipt back, and a tick that could never
   * turn would read as a delivery failure rather than as an absent feature.
   */
  _receipt(m, conv) {
    const others = (conv.participants ?? []).filter(n => n !== this.actor.name);
    const pcNames = new Set(game.users.filter(u => !u.isGM && u.character).map(u => u.character.name));
    if (!others.some(n => pcNames.has(n))) return "";

    const seenBy = (Array.isArray(m.seenBy) ? m.seenBy : []).filter(n => others.includes(n));

    if (conv.isGroup) {
      if (!seenBy.length) {
        return ` <i class="fa-solid fa-check zsm-tick" title="Delivered" aria-label="Delivered"></i>`;
      }
      return ` <span class="zsm-tick on" title="Seen by ${esc(seenBy.join(", "))}"` +
             ` aria-label="Seen by ${esc(String(seenBy.length))}">` +
             `<i class="fa-solid fa-check-double" aria-hidden="true"></i> ${seenBy.length}</span>`;
    }

    return m.seen || seenBy.length
      ? ` <i class="fa-solid fa-check-double zsm-tick on" title="Seen" aria-label="Seen"></i>`
      : ` <i class="fa-solid fa-check zsm-tick" title="Delivered" aria-label="Delivered"></i>`;
  }

  /** "Today" / "Yesterday" / a short date, for a thread's day separators. */
  _dayLabel(ts) {
    const d = new Date(Number(ts));
    const today = new Date();
    const same = (a, b) => a.toDateString() === b.toDateString();
    if (same(d, today)) return "Today";
    const y = new Date(today.getTime() - 86400_000);
    if (same(d, y)) return "Yesterday";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  _newConvPicker(ct) {
    if (!msgEnabled()) return ui.notifications.warn("Player-to-player messaging is turned off.");
    this.el?.querySelector(".zsm-picker")?.remove();

    const others = game.users.filter(u => u.character && u.character.id !== this.actor.id);
    if (!others.length) return ui.notifications.info("No other characters to message.");

    const picker = el("div", { class: "zsm-picker", role: "dialog", "aria-label": "Start a conversation" });
    picker.appendChild(el("div", { class: "zsm-picker-title", text: "Start conversation with" }));

    for (const u of others) {
      picker.appendChild(btn("zsm-picker-row", u.character.name, async () => {
        const social = loadSection(this.actor, F.social);
        let conv = social.conversations.find(c =>
          !c.isGroup &&
          c.participants.includes(u.character.name) &&
          c.participants.includes(this.actor.name));

        if (!conv) {
          conv = {
            id: convId(),
            participants: [this.actor.name, u.character.name],
            title: null, isGroup: false, messages: [], muted: false,
          };
          social.conversations.push(conv);
          await saveSection(this.actor, F.social, social);
        }
        picker.remove();
        this.convId = conv.id;
        this._paint("fwd");
      }, {
        html: `<img class="zsm-picker-img" src="${esc(portraitOf(u.character) ?? "")}" alt=""/>` +
              `<span class="zsm-picker-name">${esc(u.character.name)}</span>`,
      }));
    }

    picker.appendChild(btn("zsm-picker-cancel", "Cancel", () => picker.remove(), { text: "Cancel" }));
    ct.appendChild(picker);
  }

  // =========================================================================
  //  APP — CONTACTS  (visual-novel style)
  // =========================================================================

  /**
   * Unified, categorised contact list. Kept separate from rendering so that an
   * open detail panel can re-resolve its contact after any re-render.
   */
  _contacts(d) {
    const rels = d.relationships || [];
    const others = game.users.filter(u => !u.isGM && u.character && u.character.id !== this.actor?.id);
    const cats = { Cohort: [], Faculty: [], Students: [], Other: [] };

    // Fellow player characters auto-populate the Cohort, using any stored
    // overrides for title/portrait/rank
    for (const u of others) {
      const pd = loadSection(u.character, F.profile);
      const existing = rels.find(r => r.name === u.character.name);
      cats.Cohort.push({
        name: u.character.name,
        title: existing?.title || pd.cohort || "",
        img: existing?.img || portraitOf(u.character),
        rank: existing?.rank ?? 0,
        category: "Cohort",
        history: existing?.history || [],
        notes: existing?.notes || "",
        isPlayer: true,
        active: u.active,
        status: pd.status || "",
      });
    }

    // NPC contacts, skipping anyone already listed in the Cohort
    for (const r of rels) {
      if (cats.Cohort.find(c => c.name === r.name)) continue;
      const cat = r.category || "Other";
      (cats[cat] || cats.Other).push({ ...r, notes: r.notes || "", isPlayer: false, active: false, status: "" });
    }

    return cats;
  }

  _app_contacts(ct) {
    const d = loadAll(this.actor);
    const cats = this._contacts(d);

    // The detail panel is view state, not a tab. Without this, any re-render
    // (including the one its own notes autosave used to trigger) dumped you
    // back to the grid mid-sentence.
    if (this.relContact) {
      const open = Object.values(cats).flat().find(c => c.name === this.relContact);
      if (open) { this._relDetail(ct, open); return; }
      this.relContact = null;   // contact no longer exists
    }

    this._appBar(ct, "Contacts");
    const s = this._scroller("contacts");
    let hasAny = false;

    for (const [cat, list] of Object.entries(cats)) {
      if (!list.length) continue;
      hasAny = true;

      s.appendChild(el("div", { class: "zsr-vn-cat", text: cat }));
      const grid = el("div", { class: "zsr-vn-grid" });

      for (const r of list) {
        const ri = relInfo(r.rank ?? 0);
        const portrait = r.img || resolvePortrait(r.name);

        const circle = btn("zsr-vn-circle", `${r.name}, ${ri.label}`,
          () => { this.relContact = r.name; this._paint("fwd"); });
        circle.style.setProperty("--rel-color", ri.color);
        circle.style.setProperty("--rel-glow", ri.color + "60");

        if (portrait) circle.appendChild(el("img", { class: "zsr-vn-img", src: portrait, alt: "" }));
        else circle.appendChild(el("div", { class: "zsr-vn-ph", "aria-hidden": "true", html: '<i class="fa-solid fa-user"></i>' }));

        circle.appendChild(el("div", { class: "zsr-vn-cname", text: r.name.split(" ")[0] }));
        if (r.isPlayer && r.active) circle.appendChild(el("div", { class: "zsr-vn-online", "aria-hidden": "true" }));

        // Built here, shown on <body>: see _showTip. Anything positioned to
        // escape this circle is inside a scroller that clips on both axes.
        const tipHTML =
          `<div class="zsr-vn-tip-name">${esc(r.name)}</div>` +
          (r.title ? `<div class="zsr-vn-tip-title">${esc(r.title)}</div>` : "") +
          `<div class="zsr-vn-tip-rank" style="color:${ri.color}">${esc(ri.label)}</div>` +
          (r.isPlayer && r.status
            ? `<div class="zsr-vn-tip-status"><i class="fa-solid fa-comment-dots" aria-hidden="true"></i> ${esc(r.status)}</div>`
            : "");
        circle.addEventListener("mouseenter", () => this._showTip(circle, tipHTML));
        circle.addEventListener("focus", () => this._showTip(circle, tipHTML));
        circle.addEventListener("mouseleave", () => this._hideTip());
        circle.addEventListener("blur", () => this._hideTip());

        grid.appendChild(circle);
      }

      s.appendChild(grid);
    }

    if (!hasAny) s.appendChild(el("div", { class: "zs-empty", text: "No contacts yet." }));
    ct.appendChild(s);
  }

  _relDetail(ct, contact) {
    const ri = relInfo(contact.rank ?? 0);
    // Deliberately the actor's key art, not their token: this frame is 96x118
    // through `object-fit: cover`, so a square token loses its sides and any
    // ring baked into the token gets cut through. It is the one screen where the
    // large portrait earns its space.
    const portrait = resolveKeyArt(contact.name) || contact.img;

    this._appBar(ct, contact.name);
    const s = this._scroller("contact-" + contact.name);
    const wrap = el("div", { class: "zsr-vn-detail" });

    // --- portrait + identity card ---
    const card = el("div", { class: "zsr-vn-card" });

    const pWrap = el("div", { class: "zsr-vn-portrait" });
    pWrap.style.setProperty("--rel-color", ri.color);
    if (portrait) {
      const img = btn("zsr-vn-pbtn", `View portrait of ${contact.name}`, () => this._lightbox(portrait),
        { html: `<img src="${esc(portrait)}" alt="Portrait of ${esc(contact.name)}"/>` });
      pWrap.appendChild(img);
    } else {
      pWrap.appendChild(el("div", { class: "zsr-vn-portrait-ph", "aria-hidden": "true", html: '<i class="fa-solid fa-user"></i>' }));
    }
    card.appendChild(pWrap);

    const info = el("div", { class: "zsr-vn-dinfo" });
    info.appendChild(el("div", { class: "zsr-vn-dname", text: contact.name }));
    if (contact.title) info.appendChild(el("div", { class: "zsr-vn-dtitle", text: contact.title }));

    // --- relationship gradient bar ---
    const barWrap = el("div", { class: "zsr-vn-dbar-wrap" });
    const bar = el("div", {
      class: "zsr-vn-dbar", role: "img",
      "aria-label": `Relationship: ${ri.label}`,
    });
    bar.appendChild(el("div", {
      class: "zsr-vn-dmarker",
      style: { left: `${((contact.rank + 5) / 10) * 100}%` },
    }));
    barWrap.appendChild(bar);
    barWrap.appendChild(el("div", { class: "zsr-vn-drank", text: ri.label, style: { color: ri.color } }));
    info.appendChild(barWrap);

    if (contact.isPlayer && contact.status) {
      info.appendChild(el("div", {
        class: "zsr-vn-dstatus",
        html: `<i class="fa-solid fa-comment-dots" aria-hidden="true"></i> ${esc(contact.status)}`,
      }));
    }
    if (contact.isPlayer) {
      info.appendChild(el("div", {
        class: "zsr-vn-donline " + (contact.active ? "on" : "off"),
        text: contact.active ? "Online" : "Offline",
      }));
    }

    card.appendChild(info);
    wrap.appendChild(card);

    // --- history ---
    if (contact.history?.length) {
      const hSec = el("div", { class: "zsr-vn-hsec" });
      hSec.appendChild(el("div", { class: "zsr-vn-slabel", text: "History" }));
      for (const h of contact.history) hSec.appendChild(el("div", { class: "zsr-vn-hentry", text: h }));
      wrap.appendChild(hSec);
    }

    // --- private notes, autosaved ---
    const nSec = el("div", { class: "zsr-vn-nsec" });
    nSec.appendChild(el("div", { class: "zsr-vn-slabel", text: "Personal Notes" }));

    const ta = el("textarea", {
      class: "zsr-vn-notes",
      "data-zs-field": "notes-" + contact.name,
      "aria-label": `Your private notes about ${contact.name}`,
      placeholder: "Write your thoughts about this person…",
      rows: "4",
    });
    ta.value = contact.notes || "";

    let saveTimer;
    ta.addEventListener("input", () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        // Re-read fresh; the render-time copy may be stale by now
        const fresh = loadSection(this.actor, F.social);
        const rel = fresh.relationships.find(r => r.name === contact.name);
        if (rel) {
          rel.notes = ta.value;
        } else {
          fresh.relationships.push({
            name: contact.name,
            title: contact.title || "",
            img: contact.img || "",
            rank: contact.rank ?? 0,
            category: contact.category || "Other",
            history: [],
            notes: ta.value,
          });
        }
        // Silent: a re-render here would destroy the textarea being typed into
        await saveSection(this.actor, F.social, fresh, { silent: true });
      }, 800);
    });

    nSec.appendChild(ta);
    nSec.appendChild(el("div", { class: "zsr-vn-nhint", text: "Auto-saved as you type." }));
    wrap.appendChild(nSec);

    s.appendChild(wrap);
    ct.appendChild(s);
  }

  // =========================================================================
  //  APP — NOTES  (a Foundry journal, wearing the scroll's clothes)
  // =========================================================================

  /**
   * The student's notebook.
   *
   * Nothing here is scroll data. Each note is a page of a JournalEntry the
   * player owns, which is what buys the pop-out, the GM's view of it and the
   * sync between two open clients without any of it being written here.
   */
  /**
   * The student's notebooks — theirs, and the party's.
   *
   * Two books, one implementation: the only difference between them is who owns
   * the JournalEntry behind each, which is Foundry's problem rather than this
   * app's. See notes.mjs.
   */
  _app_notes(ct) {
    const book = this.notesBook === "party" ? "party" : "personal";
    if (this.noteId) return this._noteDetail(ct, book);

    const entry = bookFor(this.actor, book);
    const writable = canWriteNotes(this.actor, book);

    const add = writable ? btn("zsu-apbtn", "Start a new note", async () => {
      const id = await createNote(this.actor, book, book === "party" ? "New party note" : "New note");
      if (!id) return ui.notifications.warn("That note could not be started.");
      this.noteId = id;
      this._paint("fwd");
    }, { html: '<i class="fa-solid fa-plus" aria-hidden="true"></i>' }) : null;

    this._appBar(ct, "Notes", add);

    // --- the two books ---
    const tabs = el("div", { class: "zsq-tabs", role: "tablist", "aria-label": "Notebooks" });
    for (const b of BOOKS) {
      const on = b.id === book;
      const t = btn("zsq-tab" + (on ? " on" : ""), b.label, () => {
        if (on) return;
        this.notesBook = b.id;
        this.noteId = null;
        this._paint(b.id === "party" ? "fwd" : "back");
      }, { role: "tab", "aria-selected": String(on) });

      t.appendChild(el("i", { class: `fa-solid ${b.icon} zsq-tabicon`, "aria-hidden": "true" }));
      t.appendChild(el("span", { class: "zsq-tabname", text: b.label }));

      const n = noteCount(this.actor, b.id);
      if (n) t.appendChild(el("span", { class: "zsq-tabcount", text: String(n) }));
      tabs.appendChild(t);
    }
    ct.appendChild(tabs);

    const s = this._scroller("notes-" + book);

    if (!entry) {
      s.appendChild(el("div", {
        class: "zs-empty",
        text: book === "party"
          ? "The party notebook has not been opened yet. It appears the next time your GM connects."
          : "Your notebook has not been issued yet. It appears the next time your GM connects.",
      }));
      ct.appendChild(s);
      return;
    }

    const notes = listNotes(this.actor, book);
    if (!notes.length) {
      s.appendChild(el("div", {
        class: "zs-empty",
        text: book === "party"
          ? "Nothing shared yet. Anything written here, everyone reads."
          : "Nothing written down yet.",
      }));
    }

    for (const n of notes) {
      const row = btn("zsq-row", `Open note: ${n.name}`,
        () => { this.noteId = n.id; this._paint("fwd"); });

      const body = el("div", { class: "zsq-rbody" });
      body.appendChild(el("div", { class: "zsq-rname", text: n.name }));

      const prev = n.text.replace(/\s+/g, " ").slice(0, 70);
      const sub = el("div", { class: "zsq-rprev" });
      if (n.by) sub.appendChild(el("span", { class: "zsq-rby", text: n.by }));
      sub.appendChild(el("span", { text: prev || "Empty" }));
      body.appendChild(sub);
      row.appendChild(body);

      const meta = el("div", { class: "zsq-rmeta" });
      if (n.rich) {
        meta.appendChild(el("i", {
          class: "fa-solid fa-wand-magic-sparkles zsq-rich",
          title: "Formatted — edit this one in the journal", "aria-hidden": "true",
        }));
      }
      if (n.updated) meta.appendChild(el("div", { class: "zsq-rtime", text: relTime(n.updated) }));
      meta.appendChild(el("i", { class: "fa-solid fa-chevron-right zsq-rgo", "aria-hidden": "true" }));
      row.appendChild(meta);

      s.appendChild(row);
    }

    s.appendChild(btn("zsq-pop", "Open this notebook in its own window", () => {
      if (!popOutNotes(this.actor, book)) ui.notifications.warn("The notebook could not be opened.");
    }, {
      html: '<i class="fa-solid fa-up-right-from-square" aria-hidden="true"></i> ' +
            (book === "party" ? "Pop out the party notebook" : "Pop out my notebook"),
    }));

    s.appendChild(el("div", {
      class: "zsp-hint",
      text: book === "party"
        ? "The party notebook is one journal everyone owns — anyone can add to it, and everyone sees the same page."
        : "Your notes are a journal, so they open in their own window and stay in step with it.",
    }));

    ct.appendChild(s);
  }

  /**
   * One note.
   *
   * The editor is a plain textarea, so it can only be offered for pages that are
   * plain to begin with — see `isPlainish` in notes.mjs. A page with real
   * formatting on it is shown as text and pointed at the pop-out, because saving
   * would flatten the formatting rather than fail.
   */
  _noteDetail(ct, book = "personal") {
    const note = listNotes(this.actor, book).find(n => n.id === this.noteId);
    if (!note) { this.noteId = null; return this._app_notes(ct); }

    const pop = btn("zsu-apbtn", "Open this note in its own window", () => {
      if (!popOutNotes(this.actor, book, note.id)) ui.notifications.warn("The notebook could not be opened.");
    }, { html: '<i class="fa-solid fa-up-right-from-square" aria-hidden="true"></i>' });

    this._appBar(ct, book === "party" ? "Party note" : "Note", pop);
    const s = this._scroller("note-" + note.id);

    const editable = note.editable && !note.rich;

    const title = el("input", {
      class: "zsp-input zsq-title", type: "text", maxlength: "60",
      "data-zs-field": "note-title-" + note.id, "aria-label": "Note title",
      placeholder: "Untitled",
    });
    title.value = note.name;
    title.disabled = !note.editable;
    s.appendChild(title);

    if (note.by) {
      s.appendChild(el("div", { class: "zsq-byline", text: `Last written by ${note.by}` }));
    }

    const body = el("textarea", {
      class: "zsq-body", rows: "12",
      "data-zs-field": "note-body-" + note.id, "aria-label": "Note",
      placeholder: editable ? "Write it down before you forget it…" : "",
    });
    body.value = note.text;
    body.disabled = !editable;
    s.appendChild(body);

    const state = el("div", { class: "zsq-state", role: "status", text: "" });
    s.appendChild(state);

    if (note.rich) {
      s.appendChild(el("div", {
        class: "zsq-locked",
        html: '<i class="fa-solid fa-lock" aria-hidden="true"></i> ' +
              "This note carries formatting the scroll would flatten. Pop it out to change it.",
      }));
    } else if (!note.editable) {
      s.appendChild(el("div", {
        class: "zsq-locked",
        html: '<i class="fa-solid fa-lock" aria-hidden="true"></i> This note is read-only.',
      }));
    }

    if (editable) {
      let timer = null;
      const flush = async () => {
        clearTimeout(timer);
        state.textContent = "Saving…";
        // Our own write comes back as a document update. `_noteEcho` is what
        // stops that echo repainting the textarea the player is typing into.
        this._noteEcho = note.id;
        const done = await saveNote(this.actor, book, note.id, {
          name: title.value.trim(), text: body.value,
        });
        state.textContent = done ? "Saved" : "Not saved";
        setTimeout(() => { if (this._noteEcho === note.id) this._noteEcho = null; }, 500);
      };
      const queue = () => {
        clearTimeout(timer);
        state.textContent = "…";
        timer = setTimeout(flush, 800);
      };
      title.addEventListener("input", queue);
      body.addEventListener("input", queue);
      title.addEventListener("blur", flush);
      body.addEventListener("blur", flush);
    }

    if (note.editable) {
      s.appendChild(btn("zsp-danger", "Delete this note", async () => {
        const what = book === "party"
          ? `Delete "${note.name}" from the party notebook? Everyone loses it.`
          : `Delete "${note.name}"? This cannot be undone.`;
        if (!await confirmDialog("Delete Note", what)) return;
        if (await deleteNote(this.actor, book, note.id)) { this.noteId = null; this._paint("back"); }
        else ui.notifications.warn("That note could not be deleted.");
      }, { text: "Delete note" }));
    }

    ct.appendChild(s);
  }

  // =========================================================================
  //  APP — MAPS
  // =========================================================================

  /**
   * The maps the school has handed out.
   *
   * World content, like the notice board: one map, edited once, read by
   * everyone. A pin's position is a percentage rather than a pixel, so the same
   * marker lands correctly on a 480px panel and in the lightbox with nobody
   * recomputing anything.
   *
   * Undiscovered pins never reach this client at all — `visibleMaps()` strips
   * them world-side, so there is nothing here for a curious player to read out
   * of the DOM.
   */
  _app_map(ct) {
    const maps = visibleMaps();

    if (this.mapId) {
      const open = maps.find(m => m.id === this.mapId);
      if (open) return this._mapDetail(ct, open);
      this.mapId = null;   // unpublished out from under us
    }

    this._appBar(ct, "Maps");
    const s = this._scroller("maps");

    if (!maps.length) {
      s.appendChild(el("div", { class: "zs-empty", text: "No maps yet." }));
      ct.appendChild(s);
      return;
    }

    for (const m of maps) {
      const row = btn("zsmp-card", `Open ${m.name}`, () => {
        this.mapId = m.id;
        this.pinId = null;
        this._paint("fwd");
      });

      const img = safeImageSrc(m.img);
      if (img) row.appendChild(el("img", { class: "zsmp-cardimg", src: img, alt: "", loading: "lazy" }));
      else row.appendChild(el("div", {
        class: "zsmp-cardph", "aria-hidden": "true", html: '<i class="fa-solid fa-map"></i>',
      }));

      const meta = el("div", { class: "zsmp-cardmeta" });
      meta.appendChild(el("div", { class: "zsmp-cardname", text: m.name }));
      const n = (m.pins ?? []).length;
      meta.appendChild(el("div", {
        class: "zsmp-cardsub",
        text: n ? `${n} marked ${n === 1 ? "place" : "places"}` : "Nothing marked yet",
      }));
      row.appendChild(meta);

      row.appendChild(el("i", { class: "fa-solid fa-chevron-right zsq-rgo", "aria-hidden": "true" }));
      s.appendChild(row);
    }

    ct.appendChild(s);
  }

  /** One map, with its markers on it. */
  _mapDetail(ct, m) {
    const pins = m.pins ?? [];
    const img = safeImageSrc(m.img);
    const pin = this.pinId ? pins.find(p => p.id === this.pinId) : null;

    const full = img ? btn("zsu-apbtn", "See the whole map", () => {
      this._lightbox(img, m.name, [
        { icon: "fa-download", label: "Download", onClick: () => this._downloadImage(img, m.name) },
      ]);
    }, { html: '<i class="fa-solid fa-expand" aria-hidden="true"></i>' }) : null;

    this._appBar(ct, m.name, full);
    const s = this._scroller("map-" + m.id);

    const board = el("div", { class: "zsmp-board" });
    if (img) board.appendChild(el("img", { class: "zsmp-img", src: img, alt: m.name }));
    else board.appendChild(el("div", { class: "zsmp-noimg", text: "No image on this map yet." }));

    for (const p of pins) {
      const dot = btn("zsmp-pin" + (p.id === this.pinId ? " on" : ""),
        p.label || "A marked place",
        () => {
          // Tapping the open pin closes it, so the map can be looked at plain.
          this.pinId = this.pinId === p.id ? null : p.id;
          this._paint(null);
        },
        { html: `<i class="fa-solid ${esc(p.icon || "fa-location-dot")}" aria-hidden="true"></i>` });

      dot.style.left = `${p.x}%`;
      dot.style.top = `${p.y}%`;
      if (p.label) dot.appendChild(el("span", { class: "zsmp-pinlabel", text: p.label }));
      board.appendChild(dot);
    }
    s.appendChild(board);

    if (m.note) s.appendChild(el("div", { class: "zsmp-note", text: m.note }));

    if (pin) {
      const card = el("div", { class: "zsmp-detail" });
      card.appendChild(el("div", {
        class: "zsmp-dhead",
        html: `<i class="fa-solid ${esc(pin.icon || "fa-location-dot")}" aria-hidden="true"></i> ` +
              esc(pin.label || "Marked"),
      }));

      const pimg = safeImageSrc(pin.img);
      if (pimg) {
        const shot = btn("zsmp-dimg", `Look at ${pin.label || "this place"}`, () => {
          this._lightbox(pimg, pin.label || "", [
            { icon: "fa-download", label: "Download", onClick: () => this._downloadImage(pimg, pin.label) },
            {
              icon: "fa-images", label: "Save to gallery",
              onClick: async (lb, close) => {
                await addGalleryImage(this.actor, { src: pimg, caption: pin.label || "" });
                close();
                ui.notifications.info("Saved to your gallery.");
                this.refresh();
              },
            },
          ]);
        });
        shot.appendChild(el("img", { src: pimg, alt: pin.label || "" }));
        card.appendChild(shot);
      }

      if (pin.note) card.appendChild(el("div", { class: "zsmp-dnote", text: pin.note }));
      s.appendChild(card);
    } else if (pins.length) {
      s.appendChild(el("div", { class: "zsp-hint", text: "Tap a marker to read it." }));
    }

    ct.appendChild(s);
  }

  // =========================================================================
  //  APP — CAMERA
  // =========================================================================

  /**
   * Photograph the canvas as this player sees it.
   *
   * Two steps on purpose — capture, then keep or retake — because the capture
   * is free and the file it turns into is not. See capture.mjs for why the
   * photo is a render of the stage rather than a read of the screen.
   */
  _app_camera(ct) {
    this._appBar(ct, "Camera");
    const s = this._scroller("camera");

    if (!canCapture()) {
      s.appendChild(el("div", { class: "zs-empty", text: "There is no scene on screen to photograph." }));
      ct.appendChild(s);
      return;
    }

    const stage = el("div", { class: "zsc-view" });
    if (this._shot) {
      stage.appendChild(el("img", { class: "zsc-shot", src: this._shot.dataUrl, alt: "Your photograph" }));
    } else {
      stage.appendChild(el("div", {
        class: "zsc-finder", "aria-hidden": "true",
        html: '<span class="zsc-fc zsc-tl"></span><span class="zsc-fc zsc-tr"></span>' +
              '<span class="zsc-fc zsc-bl"></span><span class="zsc-fc zsc-br"></span>' +
              '<i class="fa-solid fa-camera zsc-fi"></i>',
      }));
    }
    s.appendChild(stage);

    const cap = el("input", {
      class: "zsp-input", type: "text", maxlength: "140",
      "data-zs-field": "camera-caption", "aria-label": "Caption",
      placeholder: "Caption (optional)",
    });
    s.appendChild(cap);

    if (!this._shot) {
      s.appendChild(btn("zsc-shutter", "Take a photograph", async () => {
        try {
          this._shot = await captureViewport();
          this._paint(null);
        } catch (e) {
          console.warn(`${M} | capture failed`, e);
          ui.notifications.warn(e?.message ?? "The photograph did not come out.");
        }
      }, {
        html: '<span class="zsc-ring" aria-hidden="true"></span>' +
              '<span class="zsc-slabel">Capture</span>',
      }));
    } else {
      const row = el("div", { class: "zsc-row" });
      row.appendChild(btn("zsc-keep", "Save this to your gallery", async () => {
        const shot = this._shot;
        const caption = cap.value.trim();   // read before the repaint throws the field away
        if (!shot) return;
        this._shot = null;
        this._paint(null);
        await this._storeShot(shot, caption);
      }, { html: '<i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Keep' }));

      row.appendChild(btn("zsc-retake", "Discard it and try again", () => {
        this._shot = null;
        this._paint(null);
      }, { html: '<i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Retake' }));
      s.appendChild(row);
    }

    const out = developing().filter(d => !d.failed).length;
    if (out) {
      s.appendChild(el("div", {
        class: "zsc-out", role: "status",
        html: '<span class="zsx-devspin" aria-hidden="true"></span> ' +
              `${out} ${out === 1 ? "photo is" : "photos are"} still developing.`,
      }));
    }

    s.appendChild(el("div", {
      class: "zsp-hint",
      text: canUploadDirectly()
        ? `Saved into ${captureDir()}/ and filed in your gallery. The screen you are reading is not in the shot.`
        : "Sent to your GM's client to be developed, then filed in your gallery. The screen you are reading is not in the shot.",
    }));

    ct.appendChild(s);
  }

  /**
   * Put a capture somewhere it will still be tomorrow.
   *
   * A data URL cannot live in an actor flag — it is hundreds of kilobytes, and a
   * flag is synced to every connected client every time it changes — so the
   * photo becomes a file. Most players do not have Foundry's upload permission,
   * and for them the GM's client writes it, exactly as it relays their messages.
   */
  async _storeShot(shot, caption) {
    if (canUploadDirectly()) {
      try {
        const path = await uploadCapture(shot.dataUrl, captureDir(), captureName(this.actor));
        await addGalleryImage(this.actor, { src: path, caption });
        ui.notifications.info("Photo saved to your gallery.");
        this.refresh();
      } catch (e) {
        console.error(`${M} | capture upload failed`, e);
        ui.notifications.error("The photo could not be saved.");
      }
      return;
    }

    if (!gmOnline()) {
      ui.notifications.warn("No aether link — no GM is connected, so the photo could not be developed.");
      return;
    }
    // Held locally until the GM's client says it landed, so the gallery has
    // something to show for the trip rather than nothing at all.
    const pendingId = beginDeveloping(shot.dataUrl, caption);
    emitStoreCapture(shot.dataUrl, this.actor.id, caption, pendingId);
    ui.notifications.info("Photo sent to be developed…");
    this.refresh();
  }

  // =========================================================================
  //  APP — GALLERY
  // =========================================================================

  _app_gallery(ct) {
    const imgs = getGallery(this.actor);
    const dev = developing();

    const cam = btn("zsu-apbtn", "Open the camera", () => this.go("app", "camera", "fwd"),
      { html: '<i class="fa-solid fa-camera" aria-hidden="true"></i>' });
    this._appBar(ct, "Gallery", cam);
    const s = this._scroller("gallery");

    if (!imgs.length && !dev.length) {
      s.appendChild(el("div", { class: "zs-empty", text: "No images yet. Take one with the camera." }));
      ct.appendChild(s);
      return;
    }

    /*
     * A tile that has timed out has to *become* visibly failed without the
     * player touching anything, and nothing else on this screen ticks. The timer
     * only exists while something is genuinely out, and stops when it lands.
     */
    clearTimeout(this._devTick);
    if (dev.some(d => !d.failed)) {
      this._devTick = setTimeout(() => {
        if (this.open_ && this.appId === "gallery") this._paint(null);
      }, 5000);
    }

    const grid = el("div", { class: "zsx-grid" });
    for (const d of dev) grid.appendChild(this._developingTile(d));

    for (const g of imgs) {
      // Anything that arrived from another student came off the socket, so it is
      // checked here as well as at the relay before it becomes an src.
      const src = safeImageSrc(g.src);
      if (!src) continue;

      const item = btn("zsx-item", g.caption || "View image", () => this._openImage(g, src));
      item.appendChild(el("img", { src, alt: g.caption || "", loading: "lazy" }));
      if (g.from) {
        item.appendChild(el("div", {
          class: "zsx-from",
          html: `<i class="fa-solid fa-share-nodes" aria-hidden="true"></i> ${esc(g.from)}`,
        }));
      }
      if (g.caption) item.appendChild(el("div", { class: "zsx-cap", text: g.caption }));
      grid.appendChild(item);
    }
    s.appendChild(grid);
    ct.appendChild(s);
  }

  /**
   * A photo the GM's client is still writing.
   *
   * The tile *is* the photograph, held back behind a wash — it is already in
   * memory, so a grey box would be a worse placeholder than the real thing. A
   * failed one stays put, marked, until it is tapped away: a photo that silently
   * vanished would be worse than one that says it didn't make it.
   */
  _developingTile(d) {
    const tile = btn("zsx-item zsx-dev" + (d.failed ? " zsx-devfail" : ""),
      d.failed ? "This photo did not develop. Tap to dismiss it." : "Still developing",
      () => {
        if (!d.failed) return ui.notifications.info("Still developing.");
        finishDeveloping(d.id);
        this.refresh();
      });

    tile.appendChild(el("img", { src: d.dataUrl, alt: "" }));
    tile.appendChild(el("div", {
      class: "zsx-devlabel",
      html: d.failed
        ? '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Did not develop'
        : '<span class="zsx-devspin" aria-hidden="true"></span> Developing',
    }));

    const foot = d.failed ? (d.reason || "Tap to dismiss") : d.caption;
    if (foot) tile.appendChild(el("div", { class: "zsx-cap", text: foot }));
    return tile;
  }

  /**
   * Open one of my own gallery images, with everything I can do to it.
   *
   * Deleting removes the entry, not the file: the same photo may have been
   * shared into three other galleries, and a student tidying their own should
   * not reach into anyone else's. Clearing the files themselves is the GM's job.
   */
  _openImage(g, src) {
    this._lightbox(src, g.caption, [
      {
        icon: "fa-download", label: "Download",
        onClick: () => this._downloadImage(src, g.caption),
      },
      {
        icon: "fa-share-nodes", label: "Share",
        onClick: lb => this._sharePicker(lb, src, g.caption),
      },
      {
        icon: "fa-trash", label: "Remove", danger: true,
        onClick: async (lb, close) => {
          if (!await confirmDialog("Remove Image", "Take this out of your gallery?")) return;
          await removeGalleryImage(this.actor, g.id ?? g.src);
          close();
          this.refresh();
        },
      },
    ]);
  }

  /**
   * Save an image to the player's own machine.
   *
   * Fetched into a blob first so the filename can be ours rather than whatever
   * the path ends in. If the fetch is refused — a remote image on a host with no
   * CORS headers — the plain anchor still works, it just uses the server's name.
   */
  async _downloadImage(src, caption) {
    const ext = (String(src).match(/\.(\w{2,5})(?:\?|$)/)?.[1] ?? "png").toLowerCase();
    const stem = String(caption || src.split("/").pop() || "image")
      .replace(/\.\w{2,5}$/, "")
      .replace(/[^\w -]+/g, "")
      .trim()
      .slice(0, 60) || "image";
    const name = `${stem}.${ext}`;

    const click = href => {
      const a = el("a", { href, download: name });
      document.body.appendChild(a);
      a.click();
      a.remove();
      return a;
    };

    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(res.statusText);
      const url = URL.createObjectURL(await res.blob());
      click(url);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) {
      click(src);
    }
  }

  /**
   * Choose who to send an image to.
   *
   * Multi-select, because sharing a photo of the whole party with the whole
   * party is the common case. The send itself goes through the GM relay — a
   * player cannot write another player's flags.
   */
  _sharePicker(lb, src, caption) {
    lb.querySelector(".zslb-picker")?.remove();

    if (!gmOnline()) {
      return ui.notifications.warn("No aether link — no GM is connected to pass it on.");
    }
    const others = game.users.filter(u => !u.isGM && u.character && u.character.id !== this.actor.id);
    if (!others.length) return ui.notifications.info("There is no one else to share with.");

    const picker = el("div", { class: "zslb-picker", role: "dialog", "aria-label": "Share this image" });
    picker.appendChild(el("div", { class: "zsm-picker-title", text: "Share with" }));

    const chosen = new Set();
    for (const u of others) {
      const row = btn("zsm-picker-row", `Share with ${u.character.name}`, () => {
        const id = u.character.id;
        if (chosen.has(id)) { chosen.delete(id); row.classList.remove("on"); }
        else { chosen.add(id); row.classList.add("on"); }
        row.setAttribute("aria-pressed", String(chosen.has(id)));
      }, {
        "aria-pressed": "false",
        html: `<img class="zsm-picker-img" src="${esc(portraitOf(u.character) ?? "")}" alt=""/>` +
              `<span class="zsm-picker-name">${esc(u.character.name)}</span>` +
              `<i class="fa-solid fa-check zsm-picker-tick" aria-hidden="true"></i>`,
      });
      picker.appendChild(row);
    }

    picker.appendChild(btn("zslb-send", "Send the image", () => {
      if (!chosen.size) return ui.notifications.warn("Pick someone first.");
      emitShareImage(src, caption || "", [...chosen], this.actor.name);
      picker.remove();
      ui.notifications.info(`Shared with ${chosen.size} ${chosen.size === 1 ? "student" : "students"}.`);
    }, { html: '<i class="fa-solid fa-paper-plane" aria-hidden="true"></i> Send' }));

    picker.appendChild(btn("zsm-picker-cancel", "Cancel", () => picker.remove(), { text: "Cancel" }));
    lb.appendChild(picker);
  }

  /** Pick one of your own gallery images to attach to a message. */
  _attachPicker(ct) {
    this.el?.querySelector(".zsm-picker")?.remove();

    const imgs = getGallery(this.actor).filter(g => safeImageSrc(g.src));
    if (!imgs.length) return ui.notifications.info("Your gallery is empty — take a photo first.");

    const picker = el("div", {
      class: "zsm-picker zsm-gpicker", role: "dialog", "aria-label": "Attach an image",
    });
    picker.appendChild(el("div", { class: "zsm-picker-title", text: "Attach from your gallery" }));

    const grid = el("div", { class: "zsx-grid" });
    for (const g of imgs.slice(0, 24)) {
      const src = safeImageSrc(g.src);
      const pick = btn("zsx-item", g.caption || "Attach this image", () => {
        this._attach = { src, caption: g.caption || "" };
        picker.remove();
        this._paint(null);
      });
      pick.appendChild(el("img", { src, alt: g.caption || "", loading: "lazy" }));
      grid.appendChild(pick);
    }
    picker.appendChild(grid);
    picker.appendChild(btn("zsm-picker-cancel", "Cancel", () => picker.remove(), { text: "Cancel" }));

    ct.appendChild(picker);
  }

  // =========================================================================
  //  APP — SETTINGS
  // =========================================================================

  _app_settings(ct) {
    const prefs = loadSection(this.actor, F.prefs);
    this._appBar(ct, "Settings");
    const s = this._scroller("settings");

    const save = async patch => {
      const fresh = loadSection(this.actor, F.prefs);
      Object.assign(fresh, patch);
      await saveSection(this.actor, F.prefs, fresh, { silent: true });
      app.icon?.applyAccent(this.actor);
    };

    // --- device name ---
    s.appendChild(el("div", { class: "zsp-label", text: "DEVICE NAME" }));
    const nameInp = el("input", {
      class: "zsp-input", type: "text", maxlength: "28",
      "data-zs-field": "devicename", "aria-label": "Device name",
      placeholder: `${this.actor.name.split(" ")[0]}'s Scroll`,
    });
    nameInp.value = prefs.deviceName || "";
    let nameTimer;
    nameInp.addEventListener("input", () => {
      clearTimeout(nameTimer);
      nameTimer = setTimeout(() => save({ deviceName: nameInp.value.trim() }), 700);
    });
    s.appendChild(nameInp);
    s.appendChild(el("div", { class: "zsp-hint", text: "Shown on your lock screen." }));

    // --- accent ---
    s.appendChild(el("div", { class: "zsp-label", text: "RESONANCE" }));
    const swatches = el("div", { class: "zsp-swatches", role: "radiogroup", "aria-label": "Accent colour" });
    for (const a of ACCENTS) {
      const active = (prefs.accent || "aether") === a.id;
      const sw = btn("zsp-swatch" + (active ? " on" : ""), a.label, async () => {
        await save({ accent: a.id });
        // The accent lives on the frame, outside the stage, but a full render()
        // would replay the unfurl — a jarring thing to do to someone who just
        // picked a colour. Retint in place and repaint only the stage.
        this.applyAccent();
        this._paint(null);
      }, { role: "radio", "aria-checked": String(active) });
      sw.style.setProperty("--sw", a.hue);
      sw.style.setProperty("--swd", a.deep);
      sw.appendChild(el("span", { class: "zsp-swdot", "aria-hidden": "true" }));
      sw.appendChild(el("span", { class: "zsp-swname", text: a.label }));
      swatches.appendChild(sw);
    }
    s.appendChild(swatches);
    s.appendChild(el("div", { class: "zsp-hint", text: "Tints your stone and your projection." }));

    // --- toggles ---
    s.appendChild(el("div", { class: "zsp-label", text: "BEHAVIOUR" }));
    s.appendChild(this._toggle("Skip the lock screen", !!prefs.skipLock, async v => {
      await save({ skipLock: v });
    }));
    s.appendChild(this._toggle("Reduce motion", !!prefs.reduceMotion, async v => {
      await save({ reduceMotion: v });
      // Same reasoning as the accent: toggle the class the animations key off
      // rather than tearing the projection down and building it again. setCalm
      // also settles anything caught mid-transition by the change.
      this.setCalm(reducedMotion({ reduceMotion: v }));
    }));

    // --- alert log ---
    s.appendChild(el("div", { class: "zsp-label", text: "ALERTS" }));
    const count = getNotifications(this.actor).length;
    s.appendChild(el("div", { class: "zsp-hint", text: `${count} in the log.` }));
    s.appendChild(btn("zsp-danger", "Clear the alert log", async () => {
      if (!count) return;
      if (!await confirmDialog("Clear Alerts", "Clear the whole alert log?")) return;
      await clearNotifications(this.actor);
      this._syncChrome();
      this._paint(null);
    }, { text: "Clear log" }));

    ct.appendChild(s);
  }

  /** A labelled switch. Real checkbox underneath, so it is keyboard-reachable. */
  _toggle(label, value, onChange) {
    const row = el("label", { class: "zsp-toggle" });
    const box = el("input", { type: "checkbox", class: "zsp-tbox" });
    box.checked = value;
    box.addEventListener("change", () => onChange(box.checked));
    row.append(box, el("span", { class: "zsp-track", "aria-hidden": "true" }),
      el("span", { class: "zsp-tlabel", text: label }));
    return row;
  }

  // =========================================================================
  //  APP — ALERTS  (the notification centre)
  // =========================================================================

  /**
   * The log every toast also writes to.
   *
   * This was an overlay hung off the status bar's bell. With the bar gone it is
   * an ordinary app, which costs nothing and buys a grid badge, a dock-free
   * route in, and one less special case in the view stack.
   */
  _app_alerts(ct) {
    // Opening the list is what marks it seen. Silent, so it does not repaint the
    // list out from under the render that is drawing it.
    markNotificationsSeen(this.actor).catch(() => {});

    this._appBar(ct, "Alerts");
    const s = this._scroller("alerts");
    const list = getNotifications(this.actor);

    if (!list.length) {
      s.appendChild(el("div", { class: "zs-empty", text: "Nothing to catch up on." }));
      ct.appendChild(s);
      return;
    }

    for (const n of list) {
      // A row is a wrapper, not a button: the dismiss control is a button, and a
      // button inside a button is invalid markup that browsers resolve by
      // dropping one of them.
      const row = el("div", { class: "zsy-row" + (n.read ? "" : " zsy-new") });

      const bodyHTML =
        `<i class="fa-solid ${esc(n.icon || "fa-bell")} zsy-icon" aria-hidden="true"></i>` +
        `<span class="zsy-copy"><span class="zsy-title">${esc(n.title)}</span>` +
        (n.body ? `<span class="zsy-body">${esc(n.body)}</span>` : "") + `</span>` +
        `<span class="zsy-age">${esc(relTime(n.ts))}</span>`;

      if (n.app) {
        row.appendChild(btn("zsy-open",
          `${n.title}: ${n.body}. Open ${appInfo(n.app)?.label ?? n.app}.`,
          () => this.go("app", n.app, "fwd"), { html: bodyHTML }));
      } else {
        row.appendChild(el("div", { class: "zsy-open zsy-flat", html: bodyHTML }));
      }

      row.appendChild(btn("zsy-x", `Dismiss: ${n.title}`, async () => {
        await dismissNotification(this.actor, n.id);
        this._syncChrome();
        this._paint(null);
      }, { html: '<i class="fa-solid fa-xmark" aria-hidden="true"></i>' }));

      s.appendChild(row);
    }

    s.appendChild(btn("zsp-danger", "Clear the notification log", async () => {
      if (!await confirmDialog("Clear Alerts", "Clear the whole alert log?")) return;
      await clearNotifications(this.actor);
      this._syncChrome();
      this._paint(null);
    }, { text: "Clear log" }));

    ct.appendChild(s);
  }

  // =========================================================================
  //  APP — BANK
  // =========================================================================

  /**
   * Balances, and what moved them.
   *
   * The balances themselves are inventory-item quantities, so this app is a
   * read-out of something the character sheet already knows. The ledger is what
   * makes it more than that: `zs.grant()` writes a dated line every time a
   * balance moves, which is the first time in the module's life that currency
   * has had a surface of its own rather than a number on the ID card.
   */
  _app_bank(ct) {
    this._appBar(ct, "Bank");
    const s = this._scroller("bank");

    const balances = getBalances(this.actor);
    const cards = el("div", { class: "zsk-cards" });

    for (const b of balances) {
      const card = el("div", { class: "zsk-card" });
      card.style.setProperty("--cur-tint", b.tint);
      card.innerHTML =
        `<div class="zsk-glow" aria-hidden="true"></div>` +
        `<i class="fa-solid ${esc(b.icon)} zsk-icon" aria-hidden="true"></i>` +
        `<div class="zsk-amount">${b.amount}</div>` +
        `<div class="zsk-label">${esc(b.label)}</div>`;
      cards.appendChild(card);
    }
    s.appendChild(cards);

    const ledger = getLedger(this.actor);
    s.appendChild(el("div", { class: "zsk-lhead", text: "LEDGER" }));

    if (!ledger.length) {
      s.appendChild(el("div", { class: "zs-empty", text: "No transactions recorded." }));
      ct.appendChild(s);
      return;
    }

    const byKey = new Map(balances.map(b => [b.key, b]));
    for (const e of ledger) {
      const cur = byKey.get(e.currency);
      const up = Number(e.delta) > 0;
      const row = el("div", { class: "zsk-row" + (up ? " up" : " down") });
      row.innerHTML =
        `<div class="zsk-rdelta">${up ? "+" : "−"}${Math.abs(Number(e.delta) || 0)}</div>` +
        `<div class="zsk-rinfo">` +
          `<div class="zsk-rreason">${esc(e.reason || (up ? "Deposit" : "Withdrawal"))}</div>` +
          `<div class="zsk-rmeta">${esc(cur?.label ?? e.currency)} · balance ${Number(e.balance) || 0}</div>` +
        `</div>` +
        `<div class="zsk-rage">${esc(relTime(e.ts))}</div>`;
      s.appendChild(row);
    }

    ct.appendChild(s);
  }

  // =========================================================================
  //  LIGHTBOX
  // =========================================================================

  /**
   * Full-screen image view.
   *
   * `actions` are the things that can be done to the image, rendered as a bar
   * under it. Each handler is called with the lightbox element and its close
   * function — enough to hang a picker off, or to close after deleting.
   */
  _lightbox(src, caption, actions = []) {
    const lb = el("div", {
      id: "zs-lightbox", role: "dialog", "aria-modal": "true",
      "aria-label": caption || "Image",
      onclick: e => {
        if (e.target.id === "zs-lightbox" || e.target.closest(".zslb-close")) close();
      },
    });

    const close = () => {
      // Registered on the capture phase, so it has to be removed on it too.
      document.removeEventListener("keydown", onKey, true);
      lb.remove();
    };
    const onKey = e => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };

    lb.innerHTML =
      `<div class="zslb-wrap">` +
      `<button type="button" class="zslb-close" aria-label="Close image">×</button>` +
      `<img class="zslb-img" src="${esc(src)}" alt="${esc(caption || "")}"/>` +
      (caption ? `<div class="zslb-cap">${esc(caption)}</div>` : "") +
      `</div>`;

    if (actions.length) {
      const bar = el("div", { class: "zslb-actions" });
      for (const a of actions) {
        bar.appendChild(btn("zslb-act" + (a.danger ? " zslb-danger" : ""), a.label,
          () => a.onClick(lb, close),
          { html: `<i class="fa-solid ${esc(a.icon)}" aria-hidden="true"></i> ${esc(a.label)}` }));
      }
      lb.querySelector(".zslb-wrap")?.appendChild(bar);
    }

    document.body.appendChild(lb);
    // Capture phase, so this beats the device's own Escape handler.
    document.addEventListener("keydown", onKey, true);
    lb.querySelector(".zslb-close")?.focus({ preventScroll: true });
  }
}
