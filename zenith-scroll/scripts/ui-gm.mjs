/**
 * Zenith Academy Scroll — GM Command Center
 *
 * Per-actor editor for everything the player scroll displays, plus the
 * "copy to all students" bulk actions.
 *
 * Every save re-reads its section fresh rather than writing back the copy that
 * was loaded when the form was drawn — otherwise a save clobbers whatever
 * changed in the meantime.
 */

import { el, F, REL_SCALE, M, annId, convId, getAutoTime, app } from "./core.mjs";
import { loadSection, saveSection, getMarks } from "./data.mjs";

/** Sections, in tab order. */
const GM_TABS = [
  ["info", "Info"], ["schedule", "Schedule"], ["gift", "Gift"], ["messages", "Messages"],
  ["relationships", "Rels"], ["gallery", "Gallery"], ["announce", "Announce"], ["event", "Event"],
];

/** Every player character in the world, as actors. */
function studentActors() {
  return game.users.filter(u => !u.isGM && u.character).map(u => u.character);
}

export class GMPanel {
  constructor() {
    this.el = null;
    this.actor = null;
    this.section = "info";
  }

  open(actor) {
    if (!game.user.isGM) return;
    this.actor = actor ?? game.users.find(u => !u.isGM && u.character)?.character ?? null;
    this.section = "info";
    this.render();
  }

  close() {
    this.el?.remove();
    this.el = null;
  }

  render() {
    this.el?.remove();
    if (!this.actor) { ui.notifications.warn("No actor."); return; }

    const root = el("div", { id: "zs-gm" });
    root.addEventListener("mousedown", e => { if (e.target === root) this.close(); });

    const panel = el("div", { class: "zg-panel" });

    // --- header, with the actor picker ---
    const hdr = el("div", { class: "zg-header" });
    hdr.appendChild(el("div", { class: "zg-title", text: "Command Center" }));

    const sel = el("select", { class: "zg-actsel" });
    for (const a of game.actors) {
      const o = el("option", { value: a.id, text: a.name });
      if (a.id === this.actor.id) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => { this.actor = game.actors.get(sel.value); this.render(); });
    hdr.appendChild(sel);

    hdr.appendChild(el("div", { class: "zg-close", text: "×", onclick: () => this.close() }));
    panel.appendChild(hdr);

    // --- tabs ---
    const tabs = el("div", { class: "zg-tabs" });
    for (const [k, l] of GM_TABS) {
      tabs.appendChild(el("button", {
        class: "zg-tab" + (this.section === k ? " active" : ""),
        text: l,
        onclick: () => { this.section = k; this.render(); },
      }));
    }
    panel.appendChild(tabs);

    // --- body ---
    const body = el("div", { class: "zg-body" });
    this[`_gm_${this.section}`](body);
    panel.appendChild(body);

    root.appendChild(panel);
    document.body.appendChild(root);
    this.el = root;
  }

  // -------------------------------------------------------------------------
  //  Form helpers
  // -------------------------------------------------------------------------

  _inp(p, lbl, val, at = {}) {
    const r = el("div", { class: "zg-row" });
    r.appendChild(el("label", { text: lbl }));
    const i = el("input", { type: "text", value: val ?? "", ...at });
    r.appendChild(i);
    p.appendChild(r);
    return i;
  }

  _sel(p, lbl, val, opts) {
    const r = el("div", { class: "zg-row" });
    r.appendChild(el("label", { text: lbl }));
    const s = el("select");
    for (const [v, t] of opts) {
      const o = el("option", { value: v, text: t });
      if (String(v) === String(val)) o.selected = true;
      s.appendChild(o);
    }
    r.appendChild(s);
    p.appendChild(r);
    return s;
  }

  _ta(p, lbl, val) {
    const r = el("div", { class: "zg-row" });
    r.appendChild(el("label", { text: lbl }));
    const t = el("textarea", { rows: "3" });
    t.value = val ?? "";
    r.appendChild(t);
    p.appendChild(r);
    return t;
  }

  _save(p, fn) {
    p.appendChild(el("button", {
      class: "zg-save", html: '<i class="fa-solid fa-save"></i> Save', onclick: fn,
    }));
  }

  // -------------------------------------------------------------------------
  //  INFO
  // -------------------------------------------------------------------------

  _gm_info(body) {
    const d = loadSection(this.actor, F.profile);
    const ac = loadSection(this.actor, F.academic);

    const id = this._inp(body, "Student ID", d.studentId);
    const yr = this._sel(body, "Year", d.year,
      [["1", "First"], ["2", "Second"], ["3", "Third"], ["4", "Fourth"]]);
    const co = this._inp(body, "Cohort", d.cohort);
    const dm = this._inp(body, "Dormitory", d.dormitory);
    const nt = this._ta(body, "Notes (HTML ok)", ac.notes);

    body.appendChild(el("div", {
      class: "zg-hint",
      text: `Status: "${d.status || "(none)"}" | Marks: ${getMarks(this.actor)}`,
    }));

    this._save(body, async () => {
      const freshP = loadSection(this.actor, F.profile);
      freshP.studentId = id.value;
      freshP.year = Number(yr.value);
      freshP.cohort = co.value;
      freshP.dormitory = dm.value;
      await saveSection(this.actor, F.profile, freshP);

      const freshA = loadSection(this.actor, F.academic);
      freshA.notes = nt.value;
      await saveSection(this.actor, F.academic, freshA);

      ui.notifications.info("Saved.");
      app.ui?.refresh();
      app.icon?.pulse();
    });

    body.appendChild(el("div", { class: "zg-divider" }));
    body.appendChild(el("button", {
      class: "zg-add", text: "Copy Year + Cohort to All Students",
      onclick: async () => {
        for (const a of studentActors()) {
          const p = loadSection(a, F.profile);
          p.year = Number(yr.value);
          p.cohort = co.value;
          await saveSection(a, F.profile, p);
        }
        ui.notifications.info("Copied.");
      },
    }));
  }

  // -------------------------------------------------------------------------
  //  SCHEDULE
  // -------------------------------------------------------------------------

  _gm_schedule(body) {
    const d = loadSection(this.actor, F.academic);
    const rows = [...d.schedule];
    const ct = el("div", { class: "zg-arr" });

    const draw = () => {
      ct.innerHTML = "";
      rows.forEach((s, i) => {
        const r = el("div", { class: "zg-arow" });
        const pI = el("input", { value: s.period, placeholder: "Period", style: { maxWidth: "100px" } });
        const cI = el("input", { value: s.course, placeholder: "Course" });
        const iI = el("input", { value: s.instructor, placeholder: "Instructor" });
        const lI = el("input", { value: s.location, placeholder: "Location" });

        pI.oninput = () => rows[i].period = pI.value;
        cI.oninput = () => rows[i].course = cI.value;
        iI.oninput = () => rows[i].instructor = iI.value;
        lI.oninput = () => rows[i].location = lI.value;

        r.append(pI, cI, iI, lI, el("button", {
          class: "zg-rm", html: '<i class="fa-solid fa-xmark"></i>',
          onclick: () => { rows.splice(i, 1); draw(); },
        }));
        ct.appendChild(r);
      });
    };
    draw();
    body.appendChild(ct);

    body.appendChild(el("button", {
      class: "zg-add", html: '<i class="fa-solid fa-plus"></i> Add Period',
      onclick: () => { rows.push({ period: "", course: "", instructor: "", location: "" }); draw(); },
    }));

    this._save(body, async () => {
      const fresh = loadSection(this.actor, F.academic);
      fresh.schedule = rows;
      await saveSection(this.actor, F.academic, fresh);
      ui.notifications.info("Saved.");
      app.ui?.refresh();
    });

    body.appendChild(el("div", { class: "zg-divider" }));
    body.appendChild(el("button", {
      class: "zg-add", text: "Copy Schedule to All Students",
      onclick: async () => {
        for (const a of studentActors()) {
          const ac = loadSection(a, F.academic);
          ac.schedule = [...rows];
          await saveSection(a, F.academic, ac);
        }
        ui.notifications.info("Copied.");
      },
    }));
  }

  // -------------------------------------------------------------------------
  //  GIFT
  // -------------------------------------------------------------------------

  _gm_gift(body) {
    const d = loadSection(this.actor, F.academic);

    const gI = this._inp(body, "Gift", d.gift);
    const lI = this._inp(body, "Level", d.giftLevel, { type: "number", min: "1", max: "20" });
    const dT = this._ta(body, "Description", d.giftDescription);

    const ms = [...(d.giftMilestones || [])];
    body.appendChild(el("label", { text: "Milestones", class: "zg-sub" }));
    const mC = el("div", { class: "zg-arr" });

    const drawM = () => {
      mC.innerHTML = "";
      ms.forEach((m, i) => {
        const r = el("div", { class: "zg-arow" });
        const n = el("input", { value: m.name, placeholder: "Milestone" });
        n.oninput = () => ms[i].name = n.value;
        r.append(n,
          el("button", {
            class: "zg-tog", text: m.achieved ? "◆" : "◇",
            style: { color: m.achieved ? "#d4940a" : "#608080" },
            onclick: () => { ms[i].achieved = !ms[i].achieved; drawM(); },
          }),
          el("button", {
            class: "zg-rm", html: '<i class="fa-solid fa-xmark"></i>',
            onclick: () => { ms.splice(i, 1); drawM(); },
          }));
        mC.appendChild(r);
      });
    };
    drawM();
    body.appendChild(mC);

    body.appendChild(el("button", {
      class: "zg-add", html: '<i class="fa-solid fa-plus"></i> Add Milestone',
      onclick: () => { ms.push({ name: "", achieved: false }); drawM(); },
    }));

    this._save(body, async () => {
      const fresh = loadSection(this.actor, F.academic);
      fresh.gift = gI.value;
      fresh.giftLevel = Number(lI.value) || 1;
      fresh.giftDescription = dT.value;
      fresh.giftMilestones = ms;
      await saveSection(this.actor, F.academic, fresh);
      ui.notifications.info("Saved.");
      app.ui?.refresh();
    });
  }

  // -------------------------------------------------------------------------
  //  MESSAGES
  // -------------------------------------------------------------------------

  _gm_messages(body) {
    // --- send as an NPC ---
    body.appendChild(el("div", { class: "zg-sub", text: "Send NPC Message" }));
    const sI = this._inp(body, "From (NPC name)", "");
    const tI = this._inp(body, "Time", "");
    const xT = this._ta(body, "Message", "");
    const iI = this._inp(body, "Image path (optional)", "");

    body.appendChild(el("button", {
      class: "zg-send", html: '<i class="fa-solid fa-paper-plane"></i> Send',
      onclick: async () => {
        const msgText = xT.value;
        const senderName = sI.value;
        if (!msgText || !senderName) return ui.notifications.warn("Need sender and message.");
        const npcName = senderName.trim();

        // Re-read social data fresh at send time
        const social = loadSection(this.actor, F.social);
        let conv = social.conversations.find(c =>
          !c.isGroup && c.participants.includes(npcName) && c.participants.includes(this.actor.name));
        if (!conv) {
          conv = {
            id: convId(), participants: [this.actor.name, npcName],
            title: null, isGroup: false, messages: [], muted: false,
          };
          social.conversations.push(conv);
        }

        // time is the (optionally backdated) display string; ts is real send
        // order, which is what the thread list sorts on
        conv.messages.push({
          from: npcName, text: msgText,
          time: tI.value || getAutoTime() || "", ts: Date.now(),
          image: iI.value || "", read: false, sent: false,
        });
        await saveSection(this.actor, F.social, social);

        ui.notifications.info(`Message from ${npcName} sent.`);
        app.ui?.refresh();
        app.icon?.pulse();
        app.icon?.updateBadge(this.actor);
        sI.value = ""; tI.value = ""; xT.value = ""; iI.value = "";
      },
    }));

    // --- group chats ---
    body.appendChild(el("div", { class: "zg-divider" }));
    body.appendChild(el("div", { class: "zg-sub", text: "Create Group Chat" }));
    const groupName = this._inp(body, "Group Name", "", { placeholder: "e.g. Cohort Aurum" });
    body.appendChild(el("div", { class: "zg-hint", text: "Will add all player characters as members." }));

    body.appendChild(el("button", {
      class: "zg-add", text: "Create Group",
      onclick: async () => {
        const name = groupName.value.trim();
        if (!name) return;
        const players = studentActors();
        if (!players.length) return ui.notifications.warn("No player characters to add.");
        const participants = players.map(a => a.name);

        // Every member has to end up on the same convId or the group splits in
        // two. Adopt an existing group of this name if any member already has
        // one; this also repairs groups already split by older versions.
        let cid = null;
        for (const a of players) {
          const ex = loadSection(a, F.social).conversations.find(c => c.isGroup && c.title === name);
          if (ex) { cid = ex.id; break; }
        }
        const isNew = !cid;
        if (isNew) cid = convId();

        // Seed message so a brand-new empty group is visible in the thread list
        const seedMsg = {
          from: "Scroll", text: `${name} group created.`,
          time: getAutoTime() || "", ts: Date.now(),
          image: "", read: true, sent: false,
        };

        for (const a of players) {
          const s = loadSection(a, F.social);
          const ex = s.conversations.find(c => c.isGroup && c.title === name);
          if (ex) {
            ex.id = cid;
            ex.participants = [...participants];
          } else {
            s.conversations.push({
              id: cid, participants: [...participants], title: name,
              isGroup: true, messages: isNew ? [seedMsg] : [], muted: false,
            });
          }
          await saveSection(a, F.social, s);
        }

        ui.notifications.info(`Group "${name}" ${isNew ? "created" : "updated"}.`);
        groupName.value = "";
      },
    }));

    // --- existing conversations, read-only ---
    body.appendChild(el("div", { class: "zg-divider" }));
    const socialView = loadSection(this.actor, F.social);
    body.appendChild(el("div", { class: "zg-sub", text: `Conversations (${socialView.conversations.length})` }));
    for (const c of socialView.conversations) {
      const label = c.isGroup
        ? `[Group] ${c.title || c.participants.join(", ")}`
        : c.participants.find(n => n !== this.actor.name) || "Unknown";
      body.appendChild(el("div", { class: "zg-hint", text: `${label} (${c.messages.length} msgs)` }));
    }
  }

  // -------------------------------------------------------------------------
  //  RELATIONSHIPS
  // -------------------------------------------------------------------------

  _gm_relationships(body) {
    const social = loadSection(this.actor, F.social);
    const rels = [...(social.relationships || [])];
    const ct = el("div", { class: "zg-arr" });

    const relOpts = REL_SCALE.map(r => [String(r.val), `${r.val > 0 ? "+" : ""}${r.val} ${r.label}`]);
    const catOpts = [["Faculty", "Faculty"], ["Students", "Students"], ["Other", "Other"]];

    const draw = () => {
      ct.innerHTML = "";
      rels.forEach((r, i) => {
        const row = el("div", { class: "zg-arow zg-arow-wrap" });

        const n = el("input", { value: r.name, placeholder: "Name" });
        n.oninput = () => rels[i].name = n.value;
        const t = el("input", { value: r.title || "", placeholder: "Title" });
        t.oninput = () => rels[i].title = t.value;
        const im = el("input", { value: r.img || "", placeholder: "Portrait" });
        im.oninput = () => rels[i].img = im.value;

        const rS = el("select");
        for (const [v, tx] of relOpts) {
          const o = el("option", { value: v, text: tx });
          if (Number(v) === (r.rank ?? 0)) o.selected = true;
          rS.appendChild(o);
        }
        rS.onchange = () => rels[i].rank = Number(rS.value);

        const cS = el("select");
        for (const [v, tx] of catOpts) {
          const o = el("option", { value: v, text: tx });
          if (v === (r.category || "Other")) o.selected = true;
          cS.appendChild(o);
        }
        cS.onchange = () => rels[i].category = cS.value;

        row.append(n, t, im, rS, cS, el("button", {
          class: "zg-rm", html: '<i class="fa-solid fa-xmark"></i>',
          onclick: () => { rels.splice(i, 1); draw(); },
        }));
        ct.appendChild(row);
      });
    };
    draw();
    body.appendChild(ct);

    // --- quick add from the actor directory ---
    const addSel = el("select", { class: "zg-actsel" });
    addSel.appendChild(el("option", { value: "", text: "-- Quick add actor --" }));
    for (const a of game.actors) {
      if (rels.find(r => r.name === a.name)) continue;
      addSel.appendChild(el("option", { value: a.id, text: a.name }));
    }
    addSel.addEventListener("change", () => {
      if (!addSel.value) return;
      const a = game.actors.get(addSel.value);
      rels.push({ name: a.name, title: "", img: a.img, rank: 0, category: "Other", history: [] });
      draw();
      addSel.value = "";
    });
    body.appendChild(addSel);

    body.appendChild(el("button", {
      class: "zg-add", html: '<i class="fa-solid fa-plus"></i> Add Manually',
      onclick: () => {
        rels.push({ name: "", title: "", img: "", rank: 0, category: "Other", history: [] });
        draw();
      },
    }));

    this._save(body, async () => {
      const fresh = loadSection(this.actor, F.social);
      fresh.relationships = rels;
      await saveSection(this.actor, F.social, fresh);
      ui.notifications.info("Saved.");
      app.ui?.refresh();
    });

    body.appendChild(el("div", { class: "zg-divider" }));
    body.appendChild(el("button", {
      class: "zg-add", text: "Copy All Contacts to All Students",
      onclick: async () => {
        for (const a of studentActors()) {
          const s = loadSection(a, F.social);
          for (const r of rels) {
            if (!s.relationships.find(x => x.name === r.name)) {
              s.relationships.push(JSON.parse(JSON.stringify(r)));
            }
          }
          await saveSection(a, F.social, s);
        }
        ui.notifications.info("Contacts copied.");
      },
    }));
  }

  // -------------------------------------------------------------------------
  //  GALLERY
  // -------------------------------------------------------------------------

  _gm_gallery(body) {
    const d = loadSection(this.actor, F.media);
    const imgs = [...(d.gallery || [])];
    const ct = el("div", { class: "zg-arr" });

    const draw = () => {
      ct.innerHTML = "";
      imgs.forEach((g, i) => {
        const r = el("div", { class: "zg-arow" });
        const s = el("input", { value: g.src, placeholder: "Image path" });
        s.oninput = () => imgs[i].src = s.value;
        const c = el("input", { value: g.caption || "", placeholder: "Caption" });
        c.oninput = () => imgs[i].caption = c.value;
        r.append(s, c, el("button", {
          class: "zg-rm", html: '<i class="fa-solid fa-xmark"></i>',
          onclick: () => { imgs.splice(i, 1); draw(); },
        }));
        ct.appendChild(r);
      });
    };
    draw();
    body.appendChild(ct);

    body.appendChild(el("button", {
      class: "zg-add", html: '<i class="fa-solid fa-plus"></i> Add Image',
      onclick: () => { imgs.push({ src: "", caption: "" }); draw(); },
    }));

    let folderHint = "scroll-gallery";
    try { folderHint = game.settings.get(M, "galleryFolder"); } catch (e) { /* not registered */ }
    body.appendChild(el("div", { class: "zg-hint", text: `Gallery folder: "${folderHint}"` }));

    this._save(body, async () => {
      const fresh = loadSection(this.actor, F.media);
      fresh.gallery = imgs;
      await saveSection(this.actor, F.media, fresh);
      ui.notifications.info("Saved.");
      app.ui?.refresh();
    });
  }

  // -------------------------------------------------------------------------
  //  ANNOUNCEMENTS
  // -------------------------------------------------------------------------

  _gm_announce(body) {
    const d = loadSection(this.actor, F.system);
    const anns = [...(d.announcements || [])];
    const ct = el("div", { class: "zg-arr" });

    const draw = () => {
      ct.innerHTML = "";
      anns.forEach((a, i) => {
        const r = el("div", { class: "zg-arow" });
        const t = el("input", { value: a.text, placeholder: "Text" });
        t.oninput = () => anns[i].text = t.value;
        const tm = el("input", { value: a.time || "", placeholder: "Time", style: { maxWidth: "120px" } });
        tm.oninput = () => anns[i].time = tm.value;
        r.append(t, tm, el("button", {
          class: "zg-rm", html: '<i class="fa-solid fa-xmark"></i>',
          onclick: () => { anns.splice(i, 1); draw(); },
        }));
        ct.appendChild(r);
      });
    };
    draw();
    body.appendChild(ct);

    body.appendChild(el("button", {
      class: "zg-add", html: '<i class="fa-solid fa-plus"></i> Add',
      onclick: () => { anns.push({ id: annId(), text: "", time: "" }); draw(); },
    }));

    // Backfill ids on anything created before v1.6 so dismissals stop keying off
    // array position. Mutates in place, so repeated saves reuse the SAME id.
    const withIds = () => { for (const a of anns) if (!a.id) a.id = annId(); return anns; };

    this._save(body, async () => {
      const fresh = loadSection(this.actor, F.system);
      fresh.announcements = withIds();
      await saveSection(this.actor, F.system, fresh);
      ui.notifications.info("Saved.");
      app.ui?.refresh();
      app.icon?.pulse();
    });

    body.appendChild(el("div", { class: "zg-divider" }));
    body.appendChild(el("button", {
      class: "zg-add", text: "Push Announcements to All Students",
      onclick: async () => {
        const push = withIds();
        for (const a of studentActors()) {
          const s = loadSection(a, F.system);
          s.announcements = JSON.parse(JSON.stringify(push));
          s.dismissedAnnouncements = [];
          await saveSection(a, F.system, s);
        }
        ui.notifications.info("Pushed.");
      },
    }));
  }

  // -------------------------------------------------------------------------
  //  EVENT
  // -------------------------------------------------------------------------

  _gm_event(body) {
    const d = loadSection(this.actor, F.academic);
    const ev = this._inp(body, "Event Name", d.nextEvent, { placeholder: "e.g. Second Examination" });
    const dy = this._inp(body, "Days Until", d.nextEventDays, { type: "number", min: "0" });

    body.appendChild(el("div", { class: "zg-hint", text: "0 = TODAY. Blank name hides it." }));

    this._save(body, async () => {
      const fresh = loadSection(this.actor, F.academic);
      fresh.nextEvent = ev.value;
      fresh.nextEventDays = Number(dy.value) || 0;
      await saveSection(this.actor, F.academic, fresh);
      ui.notifications.info("Saved.");
      app.ui?.refresh();
    });

    body.appendChild(el("div", { class: "zg-divider" }));
    body.appendChild(el("button", {
      class: "zg-add", text: "Set Event for All Students",
      onclick: async () => {
        for (const a of studentActors()) {
          const ac = loadSection(a, F.academic);
          ac.nextEvent = ev.value;
          ac.nextEventDays = Number(dy.value) || 0;
          await saveSection(a, F.academic, ac);
        }
        ui.notifications.info("Set for all.");
      },
    }));
  }
}
