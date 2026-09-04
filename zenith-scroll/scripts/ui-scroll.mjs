/**
 * Zenith Academy Scroll — player interface
 *
 * ScrollIcon: the draggable device that sits on the canvas.
 * ScrollUI:   the scroll itself, one tab at a time.
 *
 * ScrollUI re-renders wholesale on every state change. That's why view state
 * that isn't a tab — the open conversation, the open contact — lives on the
 * instance (`convId`, `relContact`) and is re-resolved during render. Anything
 * that autosaves while the user is typing must save with `{silent: true}` so the
 * `updateActor` hook doesn't rebuild the field out from under them.
 */

import {
  M, FP, F, el, esc, app, relInfo, yearLabel, convId, getAutoTime,
  confirmDialog, CORNER_SVG,
} from "./core.mjs";
import {
  loadAll, loadSection, saveSection, getMarks, playerActor,
  resolvePortrait, findPortrait, totalUnread,
} from "./data.mjs";
import { emitMessage, msgEnabled, gmOnline } from "./socket.mjs";

// ===========================================================================
//  SCROLL ICON
// ===========================================================================

export class ScrollIcon {
  constructor() {
    this.el = null;
    this._dragged = false;   // suppresses the click that ends a drag
  }

  inject() {
    if (this.el) return;

    const d = el("div", { id: "zs-icon" });
    d.innerHTML =
      `<div class="zsi-device">` +
        `<div class="zsi-shell"></div>` +
        `<div class="zsi-panel"></div>` +
        `<div class="zsi-trim"></div>` +
        `<div class="zsi-orb"><div class="zsi-orb-bezel"></div><div class="zsi-orb-crystal"></div></div>` +
        `<div class="zsi-gem zsi-gem-t"></div>` +
        `<div class="zsi-gem zsi-gem-b"></div>` +
        `<div class="zsi-gem zsi-gem-tl"></div>` +
        `<div class="zsi-gem zsi-gem-tr"></div>` +
        `<div class="zsi-gem zsi-gem-bl"></div>` +
        `<div class="zsi-gem zsi-gem-br"></div>` +
      `</div>` +
      `<div class="zsi-label">SCROLL</div>` +
      `<div class="zsi-badge" style="display:none">0</div>`;

    d.addEventListener("click", () => {
      if (this._dragged) return;
      const a = playerActor();
      if (!a) return ui.notifications.warn("No character assigned.");
      app.ui?.toggle(a);
    });

    d.addEventListener("contextmenu", e => {
      e.preventDefault();
      if (game.user.isGM) app.gm?.open();
    });

    this._makeDraggable(d);

    document.body.appendChild(d);
    this.el = d;

    const saved = game.user.getFlag(M, FP);
    if (saved) {
      d.style.left = saved.x + "px";
      d.style.top = saved.y + "px";
      d.style.right = "auto";
      d.style.bottom = "auto";
    }
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

  pulse() {
    this.el?.classList.add("zs-pulse");
    setTimeout(() => this.el?.classList.remove("zs-pulse"), 1200);
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
  }
}

// ===========================================================================
//  PLAYER UI
// ===========================================================================

/** Tab id -> Font Awesome icon, in nav order. */
const TABS = [
  ["home",          "fa-house"],
  ["schedule",      "fa-calendar-days"],
  ["gift",          "fa-star"],
  ["messages",      "fa-comment"],
  ["relationships", "fa-heart"],
  ["gallery",       "fa-image"],
];

export class ScrollUI {
  constructor() {
    this.el = null;
    this.actor = null;
    this.tab = "home";
    this.open_ = false;
    this.convId = null;      // open conversation, within the messages tab
    this.relContact = null;  // open contact, within the relationships tab
  }

  toggle(a) {
    if (this.open_ && this.actor?.id === a?.id) this.close();
    else this.show(a);
  }

  show(a) {
    this.actor = a;
    this.tab = "home";
    this.convId = null;
    this.relContact = null;
    this.open_ = true;
    this.render();
  }

  close() {
    this.open_ = false;
    if (this.el) {
      this.el.classList.add("zs-out");
      setTimeout(() => { this.el?.remove(); this.el = null; }, 300);
    }
  }

  refresh() {
    if (this.open_ && this.actor) this.render();
  }

  // -------------------------------------------------------------------------
  //  Frame
  // -------------------------------------------------------------------------

  render() {
    this.el?.remove();

    const data = loadAll(this.actor);
    const marks = getMarks(this.actor);

    const root = el("div", { id: "zs-ui" });
    root.addEventListener("mousedown", e => { if (e.target === root) this.close(); });

    const frame = el("div", { class: "zsu-frame" });
    frame.appendChild(el("div", { class: "zsu-close", text: "×", onclick: () => this.close() }));

    // --- device shell: trim, corner flourishes, gems, side orbs ---
    const body = el("div", { class: "zsu-body" });
    body.appendChild(el("div", { class: "zsu-gold-trim" }));
    for (const p of ["tl", "tr", "bl", "br"]) {
      body.appendChild(el("div", { class: `zsu-corner zsu-corner-${p}`, html: CORNER_SVG }));
    }
    for (const p of ["tl", "tr", "bl", "br", "ml", "mr"]) {
      body.appendChild(el("div", { class: `zsu-gem zsu-gem-${p}` }));
    }
    for (const s of ["l", "r"]) {
      const o = el("div", { class: `zsu-orb zsu-orb-${s}` });
      o.innerHTML = `<div class="zsu-orb-bezel"></div><div class="zsu-orb-crystal"></div>`;
      body.appendChild(o);
    }

    // --- screen ---
    const inner = el("div", { class: "zsu-inner-frame" });
    const screen = el("div", { class: "zsu-screen" });
    screen.appendChild(el("div", { class: "zsu-scanline" }));

    const content = el("div", { class: "zsu-content" });
    const ci = el("div", { class: "zsu-inner" });
    this[`_${this.tab}`](ci, data, marks);
    content.appendChild(ci);
    screen.appendChild(content);

    // --- nav ---
    const nav = el("div", { class: "zsu-nav" });
    const unread = totalUnread(this.actor);
    for (const [t, ico] of TABS) {
      nav.appendChild(el("button", {
        class: "zsu-navbtn" + (this.tab === t ? " active" : ""),
        html: `<i class="fa-solid ${ico}"></i>` +
              (t === "messages" && unread > 0 ? '<span class="zsu-navdot"></span>' : ""),
        title: t[0].toUpperCase() + t.slice(1),
        onclick: () => {
          this.tab = t;
          this.convId = null;
          this.relContact = null;
          this.render();
        },
      }));
    }
    screen.appendChild(nav);

    inner.appendChild(screen);
    body.appendChild(inner);
    frame.appendChild(body);
    root.appendChild(frame);
    document.body.appendChild(root);
    this.el = root;

    // Boot animation: the scanline sweep finishes, then content fades up
    setTimeout(() => ci.classList.add("zsu-booted"), 250);
  }

  // -------------------------------------------------------------------------
  //  HOME
  // -------------------------------------------------------------------------

  _home(ct, d, marks) {
    // Dismissals key off a stable announcement id. Pre-v1.6 announcements have
    // no id, so they fall back to their index, matching how their dismissals
    // were stored at the time.
    const dismissed = (d.dismissedAnnouncements || []).map(String);
    const anns = (d.announcements || []).map((a, i) => {
      const key = String(a.id ?? i);
      if (dismissed.includes(key)) return "";
      return `<div class="zsh-ann"><i class="fa-solid fa-bullhorn"></i> ${esc(a.text)} ` +
             `<span class="zsh-antime">${esc(a.time || "")}</span>` +
             `<span class="zsh-ann-x" data-key="${esc(key)}">×</span></div>`;
    }).join("");

    let evtH = "";
    if (d.nextEvent) {
      const dy = d.nextEventDays ?? 0;
      evtH = `<div class="zsh-event"><div class="zsh-evlabel">NEXT EVENT</div>` +
             `<div class="zsh-evname">${esc(d.nextEvent)}</div>` +
             `<div class="zsh-evdays">${dy === 0 ? "TODAY" : dy === 1 ? "TOMORROW" : `${dy} days`}</div></div>`;
    }

    // d.notes is GM-authored and may intentionally contain HTML, so it is not escaped
    ct.innerHTML = `
    <div class="zsh-header"><div class="zsh-portrait"><img src="${esc(this.actor.img)}"/></div><div class="zsh-info"><div class="zsh-name">${esc(this.actor.name)}</div>${d.cohort ? `<div class="zsh-cohort">${esc(d.cohort)}</div>` : ""}<div class="zsh-id">${esc(d.studentId)}</div><div class="zsh-status" id="zsh-sd">${d.status ? `<span class="zsh-stxt">${esc(d.status)}</span>` : `<span class="zsh-stxt zsh-stph">Tap to set status...</span>`}</div></div></div>
    ${evtH}${anns ? `<div class="zsh-announce">${anns}</div>` : ""}
    <div class="zsh-stats"><div class="zsh-stat"><div class="zsh-sl">YEAR</div><div class="zsh-sv">${yearLabel(d.year)}</div></div><div class="zsh-stat"><div class="zsh-sl">MARKS</div><div class="zsh-sv zsh-gold">${marks}</div></div><div class="zsh-stat"><div class="zsh-sl">GIFT</div><div class="zsh-sv zsh-sm">${esc(d.gift) || "—"}</div></div></div>
    ${d.dormitory ? `<div class="zsh-detail"><span class="zsh-dl">DORMITORY</span><span>${esc(d.dormitory)}</span></div>` : ""}
    ${d.notes ? `<div class="zsh-notes">${d.notes}</div>` : ""}`;

    // --- inline status editor ---
    ct.querySelector("#zsh-sd")?.addEventListener("click", () => {
      if (ct.querySelector(".zsh-statinput")) return;   // already editing; don't wipe the field

      const inp = el("input", {
        class: "zsh-statinput", type: "text", value: d.status || "",
        placeholder: "What's on your mind?", maxlength: "80",
      });
      ct.querySelector("#zsh-sd").replaceChildren(inp);
      inp.focus();

      let saved = false;
      const save = async () => {
        if (saved) return;   // Enter also triggers blur; only write once
        saved = true;
        const p = loadSection(this.actor, F.profile);
        p.status = inp.value.trim();
        await saveSection(this.actor, F.profile, p);
        this.render();
      };

      inp.addEventListener("blur", save);
      inp.addEventListener("keydown", e => { if (e.key === "Enter") save(); });
    });

    // --- dismiss announcements ---
    ct.querySelectorAll(".zsh-ann-x").forEach(b => b.addEventListener("click", async e => {
      e.stopPropagation();
      if (!await confirmDialog("Dismiss Announcement", "Dismiss this announcement?")) return;
      const sys = loadSection(this.actor, F.system);
      if (!sys.dismissedAnnouncements) sys.dismissedAnnouncements = [];
      sys.dismissedAnnouncements.push(b.dataset.key);
      await saveSection(this.actor, F.system, sys);
      this.render();
    }));
  }

  // -------------------------------------------------------------------------
  //  SCHEDULE
  // -------------------------------------------------------------------------

  _schedule(ct, d) {
    const rows = d.schedule.filter(s => s.course).map(s =>
      `<div class="zss-row"><div class="zss-period">${esc(s.period)}</div>` +
      `<div class="zss-info"><div class="zss-course">${esc(s.course)}</div>` +
      `<div class="zss-meta">${esc(s.instructor)}${s.location ? " · " + esc(s.location) : ""}</div>` +
      `</div></div>`).join("");

    ct.innerHTML = `<div class="zs-ttl">Class Schedule</div>` +
      (rows || '<div class="zs-empty">No classes scheduled.</div>');
  }

  // -------------------------------------------------------------------------
  //  GIFT
  // -------------------------------------------------------------------------

  _gift(ct, d) {
    if (!d.gift) {
      ct.innerHTML = `<div class="zs-ttl">Gift Details</div><div class="zs-empty">No Gift data.</div>`;
      return;
    }

    const ms = (d.giftMilestones || []).map(m =>
      `<div class="zsg-ms ${m.achieved ? "done" : ""}">` +
      `<span class="zsg-dot">${m.achieved ? "◆" : "◇"}</span>` +
      `<span>${esc(m.name)}</span></div>`).join("");

    // giftDescription is GM-authored long-form and may intentionally contain
    // HTML (as with academic.notes), so it stays unescaped.
    ct.innerHTML =
      `<div class="zs-ttl">Gift Details</div>` +
      `<div class="zsg-head"><div class="zsg-name">${esc(d.gift)}</div>` +
      `<div class="zsg-lvl">Lv${Number(d.giftLevel) || 1}</div></div>` +
      (d.giftDescription ? `<div class="zsg-desc">${d.giftDescription}</div>` : "") +
      (ms ? `<div class="zsg-mslabel">PROGRESSION</div>${ms}` : "");
  }

  // -------------------------------------------------------------------------
  //  MESSAGES
  // -------------------------------------------------------------------------

  _messages(ct, d) {
    if (this.convId) { this._convThread(ct, d); return; }

    const social = loadSection(this.actor, F.social);
    const convs = social.conversations || [];
    ct.innerHTML = `<div class="zs-ttl">Messages</div>`;

    if (msgEnabled()) {
      ct.appendChild(el("div", {
        class: "zsm-pm-btn",
        html: '<i class="fa-solid fa-plus"></i> New Conversation',
        onclick: () => this._newConvPicker(ct),
      }));
    }

    if (!convs.length) {
      ct.appendChild(el("div", { class: "zs-empty", text: "No conversations yet." }));
      return;
    }

    // Sort by last message time, most recent first. Messages written before
    // v1.6 carry no ts, so those threads fall back to reverse creation order
    // and self-heal as they get used.
    const lastTs = c => c.messages?.[c.messages.length - 1]?.ts ?? 0;
    const order = new Map(convs.map((c, i) => [c.id, i]));
    const sorted = [...convs].sort((a, b) =>
      (lastTs(b) - lastTs(a)) || ((order.get(b.id) ?? 0) - (order.get(a.id) ?? 0)));

    for (const conv of sorted) {
      const lastMsg = conv.messages?.[conv.messages.length - 1];
      const unread = (conv.messages || []).filter(m => !m.read && !m.sent).length;

      // 1-on-1 threads always show the other person, whoever sent last
      const myName = this.actor.name;
      const displayName = conv.isGroup
        ? (conv.title || conv.participants.filter(n => n !== myName).join(", "))
        : conv.participants.find(n => n !== myName) || "Unknown";

      const portrait = findPortrait(displayName, d.relationships);
      const preview = lastMsg
        ? (lastMsg.text?.length > 50 ? lastMsg.text.slice(0, 50) + "…" : lastMsg.text || "")
        : "No messages yet";

      const row = el("div", {
        class: "zsm-thread",
        onclick: () => { this.convId = conv.id; this.render(); },
      });

      if (portrait) row.appendChild(el("img", { class: "zsm-tavatar", src: portrait }));
      else row.appendChild(el("div", {
        class: "zsm-tavatar-ph",
        html: conv.isGroup ? '<i class="fa-solid fa-users"></i>' : '<i class="fa-solid fa-user"></i>',
      }));

      const info = el("div", { class: "zsm-tinfo" });
      info.innerHTML =
        `<div class="zsm-tname">${esc(displayName)}` +
        (unread ? `<span class="zsm-tunread">${unread}</span>` : "") + `</div>` +
        `<div class="zsm-tpreview">${lastMsg?.sent ? "You: " : ""}${esc(preview)}</div>`;
      row.appendChild(info);

      if (lastMsg?.time) row.appendChild(el("div", { class: "zsm-ttime", text: lastMsg.time }));
      ct.appendChild(row);
    }
  }

  _convThread(ct, d) {
    const social = loadSection(this.actor, F.social);
    const conv = social.conversations.find(c => c.id === this.convId);
    if (!conv) { this.convId = null; this._messages(ct, d); return; }

    const myName = this.actor.name;
    const displayName = conv.isGroup
      ? (conv.title || conv.participants.filter(n => n !== myName).join(", "))
      : conv.participants.find(n => n !== myName) || "Unknown";
    const portrait = findPortrait(displayName, d.relationships);

    // Mark inbound messages read. Silent, so it doesn't re-render the thread
    // we're in the middle of drawing.
    let changed = false;
    for (const m of conv.messages) {
      if (!m.read && !m.sent) { m.read = true; changed = true; }
    }
    if (changed) {
      saveSection(this.actor, F.social, social, { silent: true })
        .then(() => app.icon?.updateBadge(this.actor));
    }

    const wrap = el("div", { class: "zsm-thread-wrap" });

    // --- header ---
    const header = el("div", { class: "zsm-thread-header" });
    header.appendChild(el("div", {
      class: "zsm-back",
      html: '<i class="fa-solid fa-chevron-left"></i> Back',
      onclick: () => { this.convId = null; this.render(); },
    }));
    const hdr = el("div", { class: "zsm-thead" });
    if (portrait) hdr.appendChild(el("img", { class: "zsm-thimg", src: portrait }));
    hdr.appendChild(el("div", { class: "zsm-thname", text: displayName }));
    if (conv.isGroup) {
      hdr.appendChild(el("div", { class: "zsm-thsub", text: conv.participants.length + " members" }));
    }
    header.appendChild(hdr);
    wrap.appendChild(header);

    // --- messages ---
    const list = el("div", { class: "zsm-msglist" });
    for (const m of conv.messages) {
      const cls = m.sent ? "zsm-msg zsm-sent" : "zsm-msg";
      const senderLabel = conv.isGroup && !m.sent ? `<div class="zsm-mfrom">${esc(m.from)}</div>` : "";
      const msg = el("div", { class: cls });
      msg.innerHTML =
        senderLabel +
        `<div class="zsm-mbody">${esc(m.text)}</div>` +
        (m.image ? `<img class="zsm-mimg" src="${esc(m.image)}" data-zs-lb="${esc(m.image)}"/>` : "") +
        `<div class="zsm-mtime">${esc(m.time || "")}</div>`;
      list.appendChild(msg);
    }
    wrap.appendChild(list);

    // --- composer ---
    const reply = el("div", { class: "zsm-reply" });
    const inp = el("input", {
      class: "zsm-replyinput", type: "text",
      placeholder: "Type a message...", maxlength: "300",
    });

    const sendBtn = el("button", {
      class: "zsm-sendbtn",
      html: '<i class="fa-solid fa-paper-plane"></i>',
      onclick: async () => {
        const txt = inp.value.trim();
        if (!txt) return;

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
            ui.notifications.warn("No GM is connected — your message can't be delivered yet, so it was not sent.");
            return;
          }
        }

        const timeStr = getAutoTime() || "Now";
        const msg = { from: myName, text: txt, time: timeStr, ts: Date.now(), image: "", read: true, sent: true };
        conv.messages.push(msg);
        await saveSection(this.actor, F.social, social);

        const otherIds = otherNames.map(n => game.actors.getName(n)?.id).filter(Boolean);
        if (otherIds.length) {
          emitMessage(conv.id, conv.participants, conv.title, conv.isGroup,
            { from: myName, text: txt, time: timeStr, ts: msg.ts, image: "" },
            otherIds, myName);
        }

        inp.value = "";
        this.render();
      },
    });

    inp.addEventListener("keydown", e => { if (e.key === "Enter") sendBtn.click(); });
    reply.append(inp, sendBtn);
    wrap.appendChild(reply);
    ct.appendChild(wrap);

    setTimeout(() => list.scrollTop = list.scrollHeight, 50);
    ct.querySelectorAll("[data-zs-lb]").forEach(img =>
      img.addEventListener("click", () => this._lightbox(img.dataset.zsLb)));
  }

  _newConvPicker(ct) {
    if (!msgEnabled()) return ui.notifications.warn("Player-to-player messaging is turned off.");
    ct.querySelector(".zsm-picker")?.remove();

    const others = game.users.filter(u => u.character && u.character.id !== this.actor.id);
    if (!others.length) return ui.notifications.info("No other characters to message.");

    const picker = el("div", { class: "zsm-picker" });
    picker.appendChild(el("div", { class: "zsm-picker-title", text: "Start conversation with:" }));

    for (const u of others) {
      picker.appendChild(el("div", {
        class: "zsm-picker-row",
        onclick: async () => {
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
          this.convId = conv.id;
          this.render();
        },
      }, [
        el("img", { class: "zsm-picker-img", src: u.character.img }),
        el("div", { class: "zsm-picker-name", text: u.character.name }),
      ]));
    }

    picker.appendChild(el("div", {
      class: "zsm-picker-cancel", text: "Cancel", onclick: () => picker.remove(),
    }));
    ct.appendChild(picker);
  }

  // -------------------------------------------------------------------------
  //  RELATIONSHIPS  (visual-novel style)
  // -------------------------------------------------------------------------

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
        img: existing?.img || u.character.img,
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

  _relationships(ct, d) {
    const social = loadSection(this.actor, F.social);
    const cats = this._contacts(d);

    // The detail panel is view state, not a tab. Without this, any re-render
    // (including the one its own notes autosave used to trigger) dumped you
    // back to the grid mid-sentence.
    if (this.relContact) {
      const open = Object.values(cats).flat().find(c => c.name === this.relContact);
      if (open) { this._relDetail(ct, d, open, social); return; }
      this.relContact = null;   // contact no longer exists
    }

    ct.innerHTML = `<div class="zs-ttl">Contacts</div>`;
    let hasAny = false;

    for (const [cat, list] of Object.entries(cats)) {
      if (!list.length) continue;
      hasAny = true;

      ct.appendChild(el("div", { class: "zsr-vn-cat", text: cat }));
      const grid = el("div", { class: "zsr-vn-grid" });

      for (const r of list) {
        const ri = relInfo(r.rank ?? 0);
        const portrait = r.img || resolvePortrait(r.name);

        const circle = el("div", { class: "zsr-vn-circle" });
        circle.style.setProperty("--rel-color", ri.color);
        circle.style.setProperty("--rel-glow", ri.color + "60");

        if (portrait) circle.appendChild(el("img", { class: "zsr-vn-img", src: portrait }));
        else circle.appendChild(el("div", { class: "zsr-vn-ph", html: '<i class="fa-solid fa-user"></i>' }));

        circle.appendChild(el("div", { class: "zsr-vn-cname", text: r.name.split(" ")[0] }));
        if (r.isPlayer && r.active) circle.appendChild(el("div", { class: "zsr-vn-online" }));

        const tip = el("div", { class: "zsr-vn-tip" });
        tip.innerHTML =
          `<div class="zsr-vn-tip-name">${esc(r.name)}</div>` +
          (r.title ? `<div class="zsr-vn-tip-title">${esc(r.title)}</div>` : "") +
          `<div class="zsr-vn-tip-rank" style="color:${ri.color}">${esc(ri.label)}</div>` +
          (r.isPlayer && r.status
            ? `<div class="zsr-vn-tip-status"><i class="fa-solid fa-comment-dots"></i> ${esc(r.status)}</div>`
            : "");
        circle.appendChild(tip);

        circle.addEventListener("click", () => { this.relContact = r.name; this.render(); });
        grid.appendChild(circle);
      }

      ct.appendChild(grid);
    }

    if (!hasAny) ct.appendChild(el("div", { class: "zs-empty", text: "No contacts yet." }));
  }

  _relDetail(ct, d, contact, social) {
    const ri = relInfo(contact.rank ?? 0);
    const portrait = contact.img || resolvePortrait(contact.name);

    ct.innerHTML = "";
    const wrap = el("div", { class: "zsr-vn-detail" });

    wrap.appendChild(el("div", {
      class: "zsr-vn-back",
      html: '<i class="fa-solid fa-chevron-left"></i> Back',
      onclick: () => { this.relContact = null; this.tab = "relationships"; this.render(); },
    }));

    // --- portrait + identity card ---
    const card = el("div", { class: "zsr-vn-card" });

    const pWrap = el("div", { class: "zsr-vn-portrait" });
    pWrap.style.setProperty("--rel-color", ri.color);
    if (portrait) {
      const img = el("img", { src: portrait });
      img.addEventListener("click", () => this._lightbox(portrait));
      pWrap.appendChild(img);
    } else {
      pWrap.appendChild(el("div", { class: "zsr-vn-portrait-ph", html: '<i class="fa-solid fa-user"></i>' }));
    }
    card.appendChild(pWrap);

    const info = el("div", { class: "zsr-vn-dinfo" });
    info.appendChild(el("div", { class: "zsr-vn-dname", text: contact.name }));
    if (contact.title) info.appendChild(el("div", { class: "zsr-vn-dtitle", text: contact.title }));

    // --- relationship gradient bar ---
    const barWrap = el("div", { class: "zsr-vn-dbar-wrap" });
    const bar = el("div", { class: "zsr-vn-dbar" });
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
        html: `<i class="fa-solid fa-comment-dots"></i> ${esc(contact.status)}`,
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
      placeholder: "Write your thoughts about this person...",
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

    ct.appendChild(wrap);
    setTimeout(() => wrap.classList.add("zsr-vn-in"), 30);
  }

  // -------------------------------------------------------------------------
  //  GALLERY
  // -------------------------------------------------------------------------

  _gallery(ct, d) {
    ct.innerHTML = `<div class="zs-ttl">Gallery</div>`;
    const imgs = d.gallery || [];

    if (!imgs.length) {
      ct.appendChild(el("div", { class: "zs-empty", text: "No images." }));
      return;
    }

    const grid = el("div", { class: "zsx-grid" });
    for (const g of imgs) {
      const item = el("div", { class: "zsx-item" });
      const img = el("img", { src: g.src, alt: g.caption || "", title: g.caption || "" });
      img.addEventListener("click", () => this._lightbox(g.src, g.caption));
      item.appendChild(img);
      if (g.caption) item.appendChild(el("div", { class: "zsx-cap", text: g.caption }));
      grid.appendChild(item);
    }
    ct.appendChild(grid);
  }

  _lightbox(src, caption) {
    const lb = el("div", {
      id: "zs-lightbox",
      onclick: e => {
        if (e.target.id === "zs-lightbox" || e.target.classList.contains("zslb-close")) lb.remove();
      },
    });
    lb.innerHTML =
      `<div class="zslb-wrap"><div class="zslb-close">×</div>` +
      `<img class="zslb-img" src="${esc(src)}"/>` +
      (caption ? `<div class="zslb-cap">${esc(caption)}</div>` : "") +
      `</div>`;
    document.body.appendChild(lb);
  }
}
