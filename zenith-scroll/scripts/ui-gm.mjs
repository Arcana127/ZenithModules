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

import {
  el, esc, F, REL_SCALE, M, annId, evtId, convId, uid, getAutoTime, daysLabel, app,
  currencyList, makeSalt, hashPassphrase, verifyPassphrase, relTime, confirmDialog,
} from "./core.mjs";
import {
  loadSection, saveSection, pushNotification, portraitOf, getBalances, getLedger,
  grantCurrency, exportScrollData, scrollDataSummary, clearScrollData, refreshPortraits,
  pushImageToAll, getGiftTree, assignGiftTrees, grantGiftPoints,
} from "./data.mjs";
import {
  getAnnouncements, setAnnouncements, getEvents, setEvents,
  getMaps, setMaps, getQueued, setQueued,
  GIFT_KINDS, getGiftTrees, giftTreeById, saveGiftTree, deleteGiftTree, cleanGiftNode,
} from "./world.mjs";
import {
  resolveGiftTree, giftNodeState, validateGiftTree, refundGiftNode, resetGiftTree,
  newGiftTree, nsId, qualify,
} from "./gift.mjs";
import { ZenithAPI } from "./api.mjs";

/** Firing a queued message is the macro API's job; this is just the button. */
const sendQueued = id => ZenithAPI.sendQueued(id);

/** Hand the GM a text file. */
function saveText(text, name) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
    const a = el("a", { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    ui.notifications.info(`Exported ${name}.`);
  } catch (e) {
    console.error(`${M} | could not export`, e);
    ui.notifications.error("The export could not be written.");
  }
}
import {
  provisionNotebooks, notebookFor, partyNotebook, notebookMarkdown, allNotesMarkdown,
} from "./notes.mjs";
import { sweepCaptures } from "./sweep.mjs";

/**
 * A browse button, when this core version has a file picker to browse with.
 *
 * Returns null rather than a dead button if it does not, so the caller simply
 * ends up with the plain path field it already had.
 */
function pickFile(onPick) {
  const FP = globalThis.foundry?.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
  if (!FP) return null;

  let start = "scroll-gallery";
  try { start = String(game.settings.get(M, "galleryFolder") || start); } catch (e) { /* unregistered */ }

  return el("button", {
    class: "zg-rm zg-browse", title: "Browse for an image",
    html: '<i class="fa-solid fa-folder-open"></i>',
    onclick: ev => {
      ev.preventDefault();
      try { new FP({ type: "image", current: start, callback: onPick }).render(true); }
      catch (e) { ui.notifications.warn("The file picker could not be opened."); }
    },
  });
}

/** Sections, in tab order. Exported so the test suite covers every one. */
export const GM_TABS = [
  ["info", "Info"], ["schedule", "Schedule"], ["gift", "Gift"], ["messages", "Messages"],
  ["relationships", "Rels"], ["bank", "Bank"], ["gallery", "Gallery"], ["maps", "Maps"],
  ["queue", "Queue"], ["announce", "Notices"],
  ["event", "Calendar"], ["danger", "Danger"],
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
    this.mapSel = null;   // which map the Maps tab is editing

    // --- Gift editor state ---
    this.giftSub = "student";  // "student" | "trees"
    this.treeSel = null;       // which tree the board is editing
    this.nodeSel = null;       // which node the inspector is showing
    this.giftSnap = true;      // snap dragged nodes to the grid
    this.giftPreview = 0;      // points to pretend the student has
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

    /*
     * The student's own notebook, which is a journal rather than scroll data.
     * Worth surfacing here because the GM has no other obvious route to it —
     * it is one entry among however many the world has, and finding it in the
     * sidebar means knowing what it is called.
     */
    const book = notebookFor(this.actor);
    const nbRow = el("div", { class: "zg-row" });
    nbRow.appendChild(el("label", { text: "Notebook" }));
    if (book) {
      nbRow.appendChild(el("button", {
        class: "zg-add zg-inline",
        html: '<i class="fa-solid fa-book"></i> Open ' + book.name,
        onclick: ev => { ev.preventDefault(); book.sheet.render(true); },
      }));
    } else {
      nbRow.appendChild(el("button", {
        class: "zg-add zg-inline",
        html: '<i class="fa-solid fa-plus"></i> Issue a notebook',
        onclick: async ev => {
          ev.preventDefault();
          const n = await provisionNotebooks();
          ui.notifications.info(`${n} notebook${n === 1 ? "" : "s"} accounted for.`);
          this.render();
        },
      }));
    }
    body.appendChild(nbRow);

    if (book) {
      const exRow = el("div", { class: "zg-row" });
      exRow.appendChild(el("label", { text: "Export notes" }));
      exRow.appendChild(el("button", {
        class: "zg-add zg-inline",
        html: '<i class="fa-solid fa-file-arrow-down"></i> Markdown',
        onclick: ev => {
          ev.preventDefault();
          const md = notebookMarkdown(this.actor, "personal");
          if (!md) return ui.notifications.warn("Nothing to export.");
          saveText(md, `${this.actor.name.replace(/[^\w -]+/g, "")} notes.md`);
        },
      }));
      exRow.appendChild(el("button", {
        class: "zg-add zg-inline",
        html: '<i class="fa-solid fa-file-arrow-down"></i> + party',
        onclick: ev => {
          ev.preventDefault();
          const md = allNotesMarkdown(this.actor);
          if (!md) return ui.notifications.warn("Nothing to export.");
          saveText(md, `${this.actor.name.replace(/[^\w -]+/g, "")} notes (with party).md`);
        },
      }));
      body.appendChild(exRow);
    }

    const party = partyNotebook();
    if (party) {
      const pRow = el("div", { class: "zg-row" });
      pRow.appendChild(el("label", { text: "Party notes" }));
      pRow.appendChild(el("button", {
        class: "zg-add zg-inline",
        html: '<i class="fa-solid fa-users"></i> Open ' + party.name,
        onclick: ev => { ev.preventDefault(); party.sheet.render(true); },
      }));
      body.appendChild(pRow);
    }

    const purse = getBalances(this.actor).map(b => `${b.label}: ${b.amount}`).join(" | ");
    body.appendChild(el("div", {
      class: "zg-hint",
      text: `Status: "${d.status || "(none)"}"  |  ${purse}`,
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

  /**
   * Two jobs behind one tab, because they are different work.
   *
   * "Student" is about the person in the actor picker: what their Gift is, which
   * trees they are on, what they have spent. "Trees" is about the library, which
   * has nothing to do with whoever happens to be selected — a trunk is edited
   * once for everyone.
   */
  _gm_gift(body) {
    const sub = el("div", { class: "zg-subtabs" });
    for (const [k, l] of [["student", "This student"], ["trees", "Tree library"]]) {
      sub.appendChild(el("button", {
        class: "zg-subtab" + (this.giftSub === k ? " active" : ""),
        type: "button", text: l,
        onclick: () => { this.giftSub = k; this.render(); },
      }));
    }
    body.appendChild(sub);

    if (this.giftSub === "trees") this._gift_library(body);
    else this._gift_student(body);
  }

  // -------------------------------------------------------------------------
  //  GIFT — the student
  // -------------------------------------------------------------------------

  _gift_student(body) {
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

    this._gift_assignment(body);
  }

  /** Which trees this student is on, what they have to spend, and what they took. */
  _gift_assignment(body) {
    const rec = getGiftTree(this.actor);
    const graph = resolveGiftTree(this.actor);
    const library = getGiftTrees();

    body.appendChild(el("div", { class: "zg-sub", text: "Trees this student is on" }));

    if (!library.length) {
      body.appendChild(el("div", {
        class: "zg-hint",
        text: "The library is empty. Build a tree under “Tree library” first.",
      }));
    }

    const list = el("div", { class: "zg-arr" });
    for (const t of library) {
      const cb = el("input", { type: "checkbox" });
      cb.checked = rec.trees.includes(t.id);
      cb.onchange = async () => {
        const on = new Set(getGiftTree(this.actor).trees);
        cb.checked ? on.add(t.id) : on.delete(t.id);
        await assignGiftTrees(this.actor, [...on]);
        this.render();
      };
      const row = el("label", { class: "zg-check" });
      row.append(cb, el("span", { text: `${t.name} — ${t.nodes.length} node${t.nodes.length === 1 ? "" : "s"}` }));
      list.appendChild(row);
    }
    body.appendChild(list);

    // A tree that was deleted while this student was assigned to it. The
    // assignment is deliberately left alone — putting the tree back should find
    // every student still on it — so it is worth saying out loud.
    const missing = rec.trees.filter(id => !library.some(t => t.id === id));
    if (missing.length) {
      body.appendChild(el("div", {
        class: "zg-hint zg-warn",
        text: `Assigned to ${missing.length} tree(s) that are no longer in the library: ${missing.join(", ")}. `
            + "The assignment is kept in case they come back.",
      }));
    }

    // --- points ---
    body.appendChild(el("div", { class: "zg-sub", text: "Points" }));
    const ptRow = el("div", { class: "zg-arow" });
    ptRow.appendChild(el("div", {
      class: "zg-ptcount",
      text: `${graph.points} to spend · ${graph.spent} spent`,
    }));
    const amt = el("input", { type: "number", value: "1", class: "zg-ptin" });
    const why = el("input", { type: "text", placeholder: "What for (optional)" });
    ptRow.append(amt, why, el("button", {
      class: "zg-add zg-inline", type: "button",
      html: '<i class="fa-solid fa-plus"></i> Grant',
      onclick: async ev => {
        ev.preventDefault();
        await grantGiftPoints(this.actor, Number(amt.value) || 0, why.value);
        this.render();
      },
    }));
    body.appendChild(ptRow);

    // --- what they have taken ---
    const taken = graph.nodes.filter(n => n.taken);
    body.appendChild(el("div", { class: "zg-sub", text: `Taken — ${taken.length} node(s)` }));

    if (!taken.length) {
      body.appendChild(el("div", { class: "zg-hint", text: "Nothing yet." }));
      return;
    }

    const tk = el("div", { class: "zg-arr" });
    for (const n of taken) {
      const row = el("div", { class: "zg-arow zg-taken" });
      row.appendChild(el("div", {
        class: "zg-tkname",
        text: `${n.name || n.localId}${n.cost ? ` · ${n.cost}pt` : ""}`,
        title: n.id,
      }));
      row.appendChild(el("button", {
        class: "zg-rm", type: "button", title: "Give this back",
        html: '<i class="fa-solid fa-rotate-left"></i>',
        onclick: async ev => {
          ev.preventDefault();
          // Named before it happens: a refund takes the dependents with it, and
          // a GM who finds out afterwards has lost work they cannot see.
          const prev = await refundGiftNode(this.actor, n.id, { preview: true });
          if (!prev.ok) return ui.notifications.warn(prev.why);
          const also = prev.nodes.filter(x => x.id !== n.id);
          const body2 = also.length
            ? `<p>Giving back <b>${esc(n.name || n.localId)}</b> also takes back ${also.length} node(s) that depend on it:</p>`
              + `<ul>${also.map(x => `<li>${esc(x.name || x.localId)}</li>`).join("")}</ul>`
              + `<p>${prev.refund} point(s) come back, and any items those unlocks granted are removed.</p>`
            : `<p>Give back <b>${esc(n.name || n.localId)}</b>? ${prev.refund} point(s) come back, `
              + "and any items it granted are removed.</p>";
          if (!await confirmDialog("Give this back?", body2)) return;
          const res = await refundGiftNode(this.actor, n.id);
          ui.notifications.info(`${res.nodes.length} node(s) refunded, ${res.refund} point(s) returned.`);
          this.render();
        },
      }));
      tk.appendChild(row);
    }
    body.appendChild(tk);

    body.appendChild(el("button", {
      class: "zg-danger", type: "button",
      html: '<i class="fa-solid fa-rotate-left"></i> Reset the whole tree',
      onclick: async ev => {
        ev.preventDefault();
        if (!await confirmDialog("Reset this tree?",
          `<p>Every node ${esc(this.actor.name)} has taken comes back, along with `
          + `${graph.spent} point(s), and every item those unlocks created is removed.</p>`)) return;
        const res = await resetGiftTree(this.actor);
        ui.notifications.info(`${res.nodes} node(s) reset, ${res.refund} point(s) back, ${res.items} item(s) removed.`);
        this.render();
      },
    }));
  }

  // -------------------------------------------------------------------------
  //  GIFT — the tree library
  // -------------------------------------------------------------------------

  /**
   * The editor.
   *
   * Maps set the precedent in v1.11: you place a pin by clicking the actual
   * preview, because typing two percentages and reloading is not a workflow.
   * Same principle here — a node is dragged where you want it, and an edge is
   * dragged from one node to another.
   *
   * Every write goes straight to the library rather than waiting for a save
   * button. A board with unsaved state is a board that loses work when the tab
   * is switched, and the tab is switched constantly while a tree is authored.
   */
  _gift_library(body) {
    const trees = getGiftTrees();
    if (!this.treeSel || !trees.some(t => t.id === this.treeSel)) this.treeSel = trees[0]?.id ?? null;

    // --- which tree ---
    const pick = el("div", { class: "zg-arow" });
    const sel = el("select");
    for (const t of trees) {
      const o = el("option", { value: t.id, text: `${t.name} (${t.nodes.length})` });
      if (t.id === this.treeSel) o.selected = true;
      sel.appendChild(o);
    }
    if (!trees.length) sel.appendChild(el("option", { value: "", text: "No trees yet" }));
    sel.onchange = () => { this.treeSel = sel.value; this.nodeSel = null; this.render(); };
    pick.appendChild(sel);

    pick.appendChild(el("button", {
      class: "zg-add zg-inline", type: "button",
      html: '<i class="fa-solid fa-plus"></i> New tree',
      onclick: async ev => {
        ev.preventDefault();
        const t = newGiftTree("New tree");
        await saveGiftTree(t);
        this.treeSel = t.id;
        this.nodeSel = null;
        this.render();
      },
    }));
    body.appendChild(pick);

    const tree = giftTreeById(this.treeSel);
    if (!tree) {
      body.appendChild(el("div", {
        class: "zg-hint",
        text: "Make a tree to start. A shared trunk everyone is on, and a branch each student gets, is the usual shape.",
      }));
      return;
    }

    // A working copy: the board mutates this and writes the whole tree back, so
    // a drag that moves a node is one settings write rather than one per pixel.
    const work = { ...tree, nodes: tree.nodes.map(n => ({ ...n })) };
    const commit = async (rerender = true) => {
      await saveGiftTree(work);
      if (rerender) this.render();
    };

    // --- name, and the tree-level buttons ---
    const nm = this._inp(body, "Name", work.name);
    nm.oninput = () => work.name = nm.value;
    nm.onchange = () => commit();

    const tools = el("div", { class: "zg-arow zg-treetools" });
    tools.appendChild(el("button", {
      class: "zg-add zg-inline", type: "button",
      html: '<i class="fa-solid fa-plus"></i> Add node',
      onclick: async ev => {
        ev.preventDefault();
        const n = cleanGiftNode({ id: uid("gn"), name: "New node", cost: 1, x: 50, y: 50 });
        work.nodes.push(n);
        this.nodeSel = n.id;
        await commit();
      },
    }));
    tools.appendChild(el("button", {
      class: "zg-add zg-inline", type: "button",
      html: '<i class="fa-solid fa-copy"></i> Duplicate tree',
      onclick: async ev => {
        ev.preventDefault();
        const copy = { ...newGiftTree(`${work.name} (copy)`), nodes: work.nodes.map(n => ({ ...n })) };
        await saveGiftTree(copy);
        this.treeSel = copy.id;
        this.render();
      },
    }));
    tools.appendChild(el("button", {
      class: "zg-delbtn", type: "button",
      html: '<i class="fa-solid fa-trash"></i> Delete tree',
      onclick: async ev => {
        ev.preventDefault();
        if (!await confirmDialog("Delete this tree?",
          `<p>“${esc(work.name)}” goes out of the library. Students assigned to it stop seeing `
          + "its nodes, but their assignment is kept — putting the tree back restores them.</p>")) return;
        await deleteGiftTree(work.id);
        this.treeSel = null;
        this.nodeSel = null;
        this.render();
      },
    }));
    body.appendChild(tools);

    // --- the board ---
    const snap = el("input", { type: "checkbox" });
    snap.checked = this.giftSnap;
    snap.onchange = () => this.giftSnap = snap.checked;
    const snapRow = el("label", { class: "zg-check zg-inline" });
    snapRow.append(snap, el("span", { text: "Snap to grid" }));

    const prev = el("input", { type: "number", min: "0", value: String(this.giftPreview), class: "zg-ptin" });
    prev.onchange = () => { this.giftPreview = Math.max(0, Number(prev.value) || 0); this.render(); };
    const prevRow = el("label", { class: "zg-check zg-inline" });
    prevRow.append(el("span", { text: "Preview as a student with" }), prev, el("span", { text: "point(s)" }));

    const opts = el("div", { class: "zg-arow" });
    opts.append(snapRow, prevRow);
    body.appendChild(opts);

    body.appendChild(this._gift_board(work, commit));
    body.appendChild(this._gift_inspector(work, commit));
    body.appendChild(this._gift_problems(work));
  }

  /**
   * The board: nodes placed by dragging, edges drawn by dragging between them.
   *
   * Positions are a percentage of the board, never a pixel — the decision map
   * pins made in v1.11. The board is one width here and 480px on the device,
   * and a percentage is correct in both without anything being recomputed.
   */
  _gift_board(work, commit) {
    const board = el("div", { class: "zgt-board" });

    /*
     * The nodes and the edges share one inset layer rather than sitting
     * directly on the board.
     *
     * A node is centred on its own coordinate and carries a link handle below
     * it and a grant badge above, so a node at 0% or 100% would have half of
     * itself outside the board — which clips it, because the board has to hide
     * overflow to keep its rounded border. Insetting the coordinate space by
     * half a node leaves the percentages meaning exactly what they mean
     * everywhere else; it just stops the extremes being unreachable.
     */
    const stage = el("div", { class: "zgt-stage" });
    board.appendChild(stage);

    /*
     * Edges are SVG over the same coordinate space as the nodes: a 0-100
     * viewBox with the aspect ratio unlocked, so a line's endpoints are the
     * node percentages exactly and nothing has to be converted. It lives in the
     * stage too, or the lines would not meet the nodes they join.
     */
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "zgt-edges");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("preserveAspectRatio", "none");
    stage.appendChild(svg);

    const mk = (tag, at) => {
      const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [k, v] of Object.entries(at)) n.setAttribute(k, v);
      return n;
    };

    const byLocal = new Map(work.nodes.map(n => [n.id, n]));
    const drawEdges = () => {
      svg.replaceChildren();
      for (const n of work.nodes) {
        for (const r of n.requires) {
          // A requirement pointing into another tree has no node on this board
          // to draw from; the problems strip names it instead.
          if (r.includes(":")) continue;
          const from = byLocal.get(r);
          if (!from) continue;

          const ends = { x1: from.x, y1: from.y, x2: n.x, y2: n.y };
          // A fat transparent line under the visible one, because a 1px stroke
          // is not something anyone can reliably click.
          const hit = mk("line", { ...ends, class: "zgt-hit" });
          hit.addEventListener("click", async ev => {
            ev.stopPropagation();
            n.requires = n.requires.filter(x => x !== r);
            await commit();
          });
          hit.appendChild(mk("title", {})).textContent =
            `${from.name || from.id} → ${n.name || n.id} — click to remove`;

          svg.append(hit, mk("line", { ...ends, class: "zgt-edge" }));
        }
      }
    };
    drawEdges();

    // --- dragging ---
    let drag = null;   // {node, mode: "move"|"link"}
    const pct = ev => {
      // Measured against the stage, not the board: that is the space the
      // percentages address.
      const r = stage.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return {
        x: Math.min(100, Math.max(0, ((ev.clientX - r.left) / r.width) * 100)),
        y: Math.min(100, Math.max(0, ((ev.clientY - r.top) / r.height) * 100)),
      };
    };
    const snapTo = v => (this.giftSnap ? Math.round(v / 2.5) * 2.5 : Math.round(v * 10) / 10);

    const ghost = mk("line", { class: "zgt-ghost", x1: 0, y1: 0, x2: 0, y2: 0 });

    const onMove = ev => {
      if (!drag) return;
      const p = pct(ev);
      if (!p) return;
      if (drag.mode === "move") {
        drag.node.x = snapTo(p.x);
        drag.node.y = snapTo(p.y);
        drag.el.style.left = `${drag.node.x}%`;
        drag.el.style.top = `${drag.node.y}%`;
        drawEdges();
      } else {
        ghost.setAttribute("x1", drag.node.x);
        ghost.setAttribute("y1", drag.node.y);
        ghost.setAttribute("x2", p.x);
        ghost.setAttribute("y2", p.y);
        if (!ghost.parentNode) svg.appendChild(ghost);
      }
    };

    const onUp = async ev => {
      if (!drag) return;
      const was = drag;
      drag = null;
      ghost.remove();
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      board.classList.remove("linking");

      if (was.mode === "move") { await commit(false); return; }

      const target = ev.target.closest?.(".zgt-node");
      const id = target?.dataset?.node;
      if (!id || id === was.node.id) return;
      const to = byLocal.get(id);
      if (!to) return;
      if (to.requires.includes(was.node.id)) return;   // already there
      to.requires = [...to.requires, was.node.id];
      await commit();
    };

    const start = (ev, node, node_el, mode) => {
      ev.preventDefault();
      ev.stopPropagation();
      drag = { node, el: node_el, mode };
      if (mode === "link") board.classList.add("linking");
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    };

    // --- the nodes ---
    // A synthetic graph so the board can show what a student with N points
    // would see. Nothing here is taken, so the honest states are "affordable",
    // "locked by cost" and "locked by requirement".
    const fake = {
      points: this.giftPreview,
      byId: new Map(work.nodes.map(n => [nsId(work.id, n.id), { ...n, taken: false }])),
    };

    for (const n of work.nodes) {
      const projected = { ...n, taken: false, requires: n.requires.map(r => qualify(work.id, r)) };
      const state = giftNodeState(fake, projected);

      const node = el("div", {
        class: `zgt-node k-${n.kind} s-${state}` + (this.nodeSel === n.id ? " sel" : ""),
        "data-node": n.id,
        title: `${n.name || n.id} — ${n.cost} point(s)`,
      });
      node.style.left = `${n.x}%`;
      node.style.top = `${n.y}%`;

      node.appendChild(el("div", { class: "zgt-label", text: n.name || n.id }));
      if (n.cost) node.appendChild(el("div", { class: "zgt-cost", text: String(n.cost) }));
      if (n.grants?.length) {
        node.appendChild(el("i", { class: "fa-solid fa-gift zgt-grantmark", "aria-hidden": "true" }));
      }

      const handle = el("button", {
        class: "zgt-handle", type: "button", title: "Drag onto another node to make it require this one",
        html: '<i class="fa-solid fa-link"></i>',
      });
      handle.addEventListener("mousedown", ev => start(ev, n, node, "link"));
      node.appendChild(handle);

      node.addEventListener("mousedown", ev => {
        if (ev.target.closest(".zgt-handle")) return;
        this.nodeSel = n.id;
        for (const other of board.querySelectorAll(".zgt-node.sel")) other.classList.remove("sel");
        node.classList.add("sel");
        this._gift_fillInspector(work, n);
        start(ev, n, node, "move");
      });

      stage.appendChild(node);
    }

    if (!work.nodes.length) {
      board.appendChild(el("div", { class: "zgt-empty", text: "Add a node to start the tree." }));
    }
    return board;
  }

  /**
   * The selected node's properties.
   *
   * Rebuilt in place rather than through a full `render()` when the selection
   * changes: a re-render would rebuild the board, and rebuilding the board
   * mid-drag drops the node being dragged.
   */
  _gift_inspector(work, commit) {
    const wrap = el("div", { class: "zgt-inspector" });
    this._giftInspectorEl = wrap;
    this._gift_fillInspector(work, work.nodes.find(n => n.id === this.nodeSel), commit);
    return wrap;
  }

  _gift_fillInspector(work, node, commit) {
    const wrap = this._giftInspectorEl;
    if (!wrap) return;
    // Called from the board's mousedown, which has no commit of its own — the
    // one the pane was built with is kept for exactly that call.
    commit = commit ?? this._giftCommit;
    this._giftCommit = commit;
    wrap.replaceChildren();

    if (!node) {
      wrap.appendChild(el("div", { class: "zg-hint", text: "Select a node to edit it." }));
      return;
    }

    wrap.appendChild(el("div", { class: "zg-sub", text: `Node — ${node.id}` }));

    const nm = this._inp(wrap, "Name", node.name);
    nm.oninput = () => node.name = nm.value;
    nm.onchange = () => commit();

    const kd = this._sel(wrap, "Kind", node.kind, GIFT_KINDS.map(k => [k, {
      buff: "Buff — sharpens what already works",
      freeform: "Freeform — widens what the Gift reaches",
      milestone: "Milestone — a story beat, not a purchase",
      capstone: "Capstone — ends a branch",
    }[k]]));
    kd.onchange = () => { node.kind = kd.value; commit(); };

    const ct = this._inp(wrap, "Cost", node.cost, { type: "number", min: "0" });
    ct.oninput = () => node.cost = Math.max(0, Math.round(Number(ct.value) || 0));
    ct.onchange = () => commit();

    const ds = this._ta(wrap, "Description", node.description);
    ds.oninput = () => node.description = ds.value;
    ds.onchange = () => commit();

    const ef = this._ta(wrap, "Effect", node.effect);
    ef.oninput = () => node.effect = ef.value;
    ef.onchange = () => commit();

    // --- requirements, including the ones that leave this tree ---
    wrap.appendChild(el("div", { class: "zg-sub", text: "Requires" }));
    const reqs = el("div", { class: "zg-arr" });
    for (const r of node.requires) {
      const known = work.nodes.find(n => n.id === r);
      const row = el("div", { class: "zg-arow" });
      row.appendChild(el("div", {
        class: "zgt-req" + (known || r.includes(":") ? "" : " bad"),
        text: known ? (known.name || known.id) : r,
        title: r,
      }));
      row.appendChild(el("button", {
        class: "zg-rm", type: "button", title: "Remove this requirement",
        html: '<i class="fa-solid fa-xmark"></i>',
        onclick: async ev => {
          ev.preventDefault();
          node.requires = node.requires.filter(x => x !== r);
          await commit();
        },
      }));
      reqs.appendChild(row);
    }
    if (!node.requires.length) {
      reqs.appendChild(el("div", { class: "zg-hint", text: "Nothing — this is a root." }));
    }
    wrap.appendChild(reqs);

    // A branch hangs off its trunk by naming a node in another tree. That edge
    // cannot be dragged, because the trunk is not on this board.
    const cross = el("div", { class: "zg-arow" });
    const other = el("select");
    other.appendChild(el("option", { value: "", text: "Require a node in another tree…" }));
    for (const t of getGiftTrees()) {
      if (t.id === work.id) continue;
      for (const n of t.nodes) {
        other.appendChild(el("option", {
          value: nsId(t.id, n.id), text: `${t.name} → ${n.name || n.id}`,
        }));
      }
    }
    other.onchange = async () => {
      if (!other.value || node.requires.includes(other.value)) return;
      node.requires = [...node.requires, other.value];
      await commit();
    };
    cross.appendChild(other);
    wrap.appendChild(cross);

    // --- grants ---
    wrap.appendChild(el("div", { class: "zg-sub", text: "Grants on unlock" }));

    const drop = el("div", {
      class: "zgt-drop",
      text: "Drag an item, feat or ability here from a compendium or the sidebar.",
    });
    drop.addEventListener("dragover", ev => { ev.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", async ev => {
      ev.preventDefault();
      drop.classList.remove("over");
      let data = null;
      try { data = JSON.parse(ev.dataTransfer.getData("text/plain")); } catch (e) { data = null; }
      if (!data?.uuid || (data.type && data.type !== "Item")) {
        return ui.notifications.warn("That is not an item.");
      }
      if (node.grants.some(g => g.uuid === data.uuid)) return;

      let doc = null;
      try { doc = await fromUuid(data.uuid); } catch (e) { doc = null; }
      if (!doc) return ui.notifications.warn("That item could not be read.");

      // The name and image are cached beside the uuid so the student's detail
      // sheet can show the grant without the pack being open — and so a uuid
      // that later goes dead still says what has gone missing.
      node.grants = [...node.grants, { uuid: data.uuid, name: doc.name ?? "", img: doc.img ?? "" }];
      await commit();
    });
    wrap.appendChild(drop);

    const gl = el("div", { class: "zg-arr" });
    for (const g of node.grants) {
      const row = el("div", { class: "zg-arow" });
      if (g.img) row.appendChild(el("img", { class: "zgt-gimg", src: g.img, alt: "" }));
      row.appendChild(el("div", { class: "zgt-gname", text: g.name || g.uuid, title: g.uuid }));
      row.appendChild(el("button", {
        class: "zg-rm", type: "button", title: "Remove this grant",
        html: '<i class="fa-solid fa-xmark"></i>',
        onclick: async ev => {
          ev.preventDefault();
          node.grants = node.grants.filter(x => x.uuid !== g.uuid);
          await commit();
        },
      }));
      gl.appendChild(row);
    }
    wrap.appendChild(gl);

    wrap.appendChild(el("button", {
      class: "zg-delbtn", type: "button",
      html: '<i class="fa-solid fa-trash"></i> Delete node',
      onclick: async ev => {
        ev.preventDefault();
        work.nodes = work.nodes.filter(n => n.id !== node.id);
        // Anything that required it would otherwise be left pointing at a node
        // that no longer exists, which is an unplayable tree rather than an
        // untidy one.
        for (const n of work.nodes) n.requires = n.requires.filter(r => r !== node.id);
        this.nodeSel = null;
        await commit();
      },
    }));
  }

  /**
   * What makes this tree unplayable, as opposed to merely unfinished.
   *
   * The same function the test suite calls — the strip is a view onto validated
   * logic, not a second opinion about it.
   */
  _gift_problems(work) {
    const wrap = el("div", { class: "zgt-problems" });
    const problems = validateGiftTree(work.id);

    const errs = problems.filter(p => p.level === "error");
    if (!problems.length) {
      wrap.appendChild(el("div", { class: "zgt-ok", text: "✓ This tree is playable." }));
      return wrap;
    }

    wrap.appendChild(el("div", {
      class: "zg-sub",
      text: errs.length ? `${errs.length} problem(s)` : "Worth a look",
    }));

    for (const p of problems) {
      const local = String(p.node ?? "").split(":").slice(1).join(":");
      wrap.appendChild(el("button", {
        class: `zgt-prob ${p.level}`, type: "button",
        text: (work.nodes.find(n => n.id === local)?.name || local || "tree") + " — " + p.message,
        onclick: ev => {
          ev.preventDefault();
          this.nodeSel = local;
          this.render();
        },
      }));
    }
    return wrap;
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
      rels.push({ name: a.name, title: "", img: portraitOf(a), rank: 0, category: "Other", history: [] });
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
      class: "zg-add", text: "Refresh Portraits From The Actor Directory",
      title: "Contacts store their portrait when they are added, so changing the " +
             "token-image setting does not reach the ones already in the list",
      onclick: async () => {
        const n = await refreshPortraits();
        ui.notifications.info(`Portraits refreshed on ${n} actor${n === 1 ? "" : "s"}.`);
        app.ui?.refresh();
        this.render();
      },
    }));

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
  //  BANK
  // -------------------------------------------------------------------------

  /**
   * Currency configuration, this student's balances, and a way to move them.
   *
   * The currency list is world-scope: it decides what the Bank app shows for
   * everybody. The grant control below it is per-actor, and is the same call the
   * macro API exposes as `zs.grant()` — every grant writes a ledger line, which
   * is what gives the Bank app a history to show.
   */
  _gm_bank(body) {
    const list = currencyList().map(c => ({ ...c }));
    const ct = el("div", { class: "zg-arr" });

    const draw = () => {
      ct.innerHTML = "";
      list.forEach((c, i) => {
        const r = el("div", { class: "zg-arow" });

        const prim = el("button", {
          class: "zg-pin" + (c.primary ? " on" : ""),
          html: '<i class="fa-solid fa-star"></i>',
          title: c.primary ? "Shown on the Student ID card" : "Show this one on the Student ID card",
          onclick: () => { list.forEach((x, j) => x.primary = i === j); draw(); },
        });

        const lb = el("input", { value: c.label ?? "", placeholder: "Label", style: { maxWidth: "120px" } });
        lb.oninput = () => list[i].label = lb.value;

        const itm = el("input", { value: c.itemName ?? "", placeholder: "Inventory item name" });
        itm.oninput = () => list[i].itemName = itm.value;

        const ic = el("input", { value: c.icon ?? "", placeholder: "fa-coins", style: { maxWidth: "120px" } });
        ic.oninput = () => list[i].icon = ic.value;

        const tn = el("input", { type: "color", value: c.tint || "#e0c050", style: { maxWidth: "48px" } });
        tn.oninput = () => list[i].tint = tn.value;

        r.append(prim, lb, itm, ic, tn, el("button", {
          class: "zg-rm", html: '<i class="fa-solid fa-xmark"></i>', title: "Remove",
          onclick: () => { list.splice(i, 1); draw(); },
        }));
        ct.appendChild(r);
      });
      if (!list.length) ct.appendChild(el("div", { class: "zg-hint", text: "No currencies configured." }));
    };
    draw();
    body.appendChild(ct);

    body.appendChild(el("button", {
      class: "zg-add", html: '<i class="fa-solid fa-plus"></i> Add Currency',
      onclick: () => {
        list.push({ key: "cur" + (list.length + 1), itemName: "", label: "New Currency",
                    icon: "fa-coins", tint: "#e0c050", primary: false });
        draw();
      },
    }));

    body.appendChild(el("div", {
      class: "zg-hint",
      text: "The item name must match an inventory item; the amount is read from its quantity. " +
            "A missing item reads 0 rather than erroring.",
    }));

    this._save(body, async () => {
      for (const c of list) if (!c.key) c.key = (c.itemName || c.label || "cur").toLowerCase();
      if (list.length && !list.some(c => c.primary)) list[0].primary = true;
      await game.settings.set(M, "currencies", list);
      ui.notifications.info("Currencies updated.");
      app.ui?.refresh();
      this.render();
    });

    // --- this student's balances and ledger ---
    body.appendChild(el("div", { class: "zg-divider" }));
    body.appendChild(el("div", { class: "zg-sub", text: `${this.actor.name} — Balances` }));

    const balances = getBalances(this.actor);
    body.appendChild(el("div", {
      class: "zg-hint",
      text: balances.map(b => `${b.label}: ${b.amount}`).join("   |   ") || "No currencies configured.",
    }));

    const grantRow = el("div", { class: "zg-arow" });
    const which = el("select");
    for (const b of balances) which.appendChild(el("option", { value: b.key, text: b.label }));
    const amt = el("input", { type: "number", value: "0", placeholder: "Amount", style: { maxWidth: "90px" } });
    const why = el("input", { value: "", placeholder: "Reason (shown in the ledger)" });

    grantRow.append(which, amt, why, el("button", {
      class: "zg-add", text: "Grant",
      onclick: async () => {
        const n = Number(amt.value);
        if (!n) return ui.notifications.warn("Enter a non-zero amount.");
        const after = await grantCurrency(this.actor, which.value, n, why.value);
        if (after === null) return ui.notifications.warn("Nothing was written.");
        await pushNotification(this.actor, {
          icon: "fa-coins",
          title: `${n > 0 ? "+" : "−"}${Math.abs(n)} ${balances.find(b => b.key === which.value)?.label ?? ""}`.trim(),
          body: why.value || (n > 0 ? "Credited to your account." : "Debited from your account."),
          app: "bank",
        });
        ui.notifications.info(`Balance is now ${after}.`);
        app.icon?.pulse();
        app.ui?.refresh();
        this.render();
      },
    }));
    body.appendChild(grantRow);

    const ledger = getLedger(this.actor);
    if (ledger.length) {
      body.appendChild(el("div", { class: "zg-sub", text: "Recent Ledger" }));
      const log = el("div", { class: "zg-arr" });
      for (const e of ledger.slice(0, 10)) {
        const d = Number(e.delta) || 0;
        log.appendChild(el("div", {
          class: "zg-hint",
          text: `${d > 0 ? "+" : "−"}${Math.abs(d)} ${e.currency} — ${e.reason || "(no reason)"} ` +
                `(balance ${Number(e.balance) || 0})`,
        }));
      }
      body.appendChild(log);
    }
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
        r.append(s, c);
        const b = pickFile(path => { s.value = path; imgs[i].src = path; });
        if (b) r.appendChild(b);
        r.append(el("button", {
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

    // -----------------------------------------------------------------------
    //  Push to everyone
    // -----------------------------------------------------------------------

    /*
     * The list above edits one student's gallery. This sends one image to all of
     * them at once, which is what you actually want after a session: the party
     * photo, the map of the tomb, the letter they found. Every recipient gets an
     * alert, so it isn't a silent change to their device.
     */
    body.appendChild(el("div", { class: "zg-hint zg-pushhead", text: "Send an image to every student" }));

    const pushRow = el("div", { class: "zg-arow" });
    const pSrc = el("input", { placeholder: "Image path" });
    const pCap = el("input", { placeholder: "Caption" });
    pushRow.append(pSrc, pCap);

    const browse = pickFile(path => { pSrc.value = path; });
    if (browse) pushRow.appendChild(browse);
    body.appendChild(pushRow);

    body.appendChild(el("button", {
      class: "zg-add",
      html: '<i class="fa-solid fa-share-nodes"></i> Send to all students',
      onclick: async () => {
        const src = pSrc.value.trim();
        if (!src) return ui.notifications.warn("Give it an image path first.");
        const n = await pushImageToAll(src, pCap.value.trim());
        if (!n) return;   // pushImageToAll has already said why
        pSrc.value = "";
        pCap.value = "";
        ui.notifications.info(`Sent to ${n} student${n === 1 ? "" : "s"}.`);
      },
    }));

    // -----------------------------------------------------------------------
    //  Housekeeping
    // -----------------------------------------------------------------------

    /*
     * Taking an image out of a gallery leaves the file alone on purpose — the
     * same photo may be in three other galleries. Over a campaign that adds up,
     * so this is the sweep that finds what the decision left behind.
     */
    body.appendChild(el("div", { class: "zg-hint zg-pushhead", text: "Capture housekeeping" }));
    body.appendChild(el("button", {
      class: "zg-add",
      html: '<i class="fa-solid fa-broom"></i> Find captures nobody has in their gallery',
      onclick: async ev => {
        ev.preventDefault();
        await sweepCaptures();
      },
    }));
    body.appendChild(el("div", { class: "zg-hint", text:
      "Lists them in the console and asks whether to put them back or hand you the " +
      "commands to remove them. Foundry has no client-side file delete." }));
  }



  // -------------------------------------------------------------------------
  //  MAPS  (world content)
  // -------------------------------------------------------------------------

  /**
   * The map editor.
   *
   * Pins are placed by clicking the preview, which is the only sane way to do
   * it — typing two percentages and reloading to see where they landed is not a
   * workflow. The preview is the same image the students see, so where you click
   * is where they look.
   *
   * `found: false` is the field worth knowing about: the pin is stored, but
   * `visibleMaps()` strips it before any player client ever sees it. A map can
   * be handed out in session one and still have somewhere to go in session nine.
   */
  _gm_maps(body) {
    const maps = getMaps().map(m => ({ ...m, pins: (m.pins ?? []).map(p => ({ ...p })) }));
    if (!this.mapSel || !maps.some(m => m.id === this.mapSel)) this.mapSel = maps[0]?.id ?? null;

    const commit = async () => {
      await setMaps(maps);
      ui.notifications.info("Maps saved.");
      app.ui?.refresh();
    };

    // --- which map ---
    const pickRow = el("div", { class: "zg-arow" });
    const sel = el("select");
    for (const m of maps) {
      const o = el("option", { value: m.id, text: m.name || "Untitled" });
      if (m.id === this.mapSel) o.selected = true;
      sel.appendChild(o);
    }
    if (!maps.length) sel.appendChild(el("option", { value: "", text: "No maps yet" }));
    sel.onchange = () => { this.mapSel = sel.value; this.render(); };
    pickRow.appendChild(sel);

    pickRow.appendChild(el("button", {
      class: "zg-add zg-inline", html: '<i class="fa-solid fa-plus"></i> New map',
      onclick: async ev => {
        ev.preventDefault();
        maps.push({ id: uid("map"), name: "New map", img: "", note: "", published: true, pins: [] });
        this.mapSel = maps[maps.length - 1].id;
        await setMaps(maps);
        this.render();
      },
    }));
    body.appendChild(pickRow);

    const map = maps.find(m => m.id === this.mapSel);
    if (!map) {
      body.appendChild(el("div", { class: "zg-hint", text: "Make a map to start marking places on it." }));
      return;
    }

    // --- the map itself ---
    const nm = this._inp(body, "Name", map.name);
    nm.oninput = () => map.name = nm.value;

    const imgRow = el("div", { class: "zg-row" });
    imgRow.appendChild(el("label", { text: "Image" }));
    const im = el("input", { type: "text", value: map.img ?? "", placeholder: "maps/academy.webp" });
    im.oninput = () => map.img = im.value;
    imgRow.appendChild(im);
    const browse = pickFile(path => { im.value = path; map.img = path; this.render(); });
    if (browse) imgRow.appendChild(browse);
    body.appendChild(imgRow);

    const nt = this._ta(body, "Note", map.note);
    nt.oninput = () => map.note = nt.value;

    const pub = el("input", { type: "checkbox" });
    pub.checked = map.published !== false;
    pub.onchange = () => map.published = pub.checked;
    const pubRow = el("label", { class: "zg-check" });
    pubRow.append(pub, el("span", { text: "Students can see this map" }));
    body.appendChild(pubRow);

    // --- the board: click to place ---
    body.appendChild(el("div", { class: "zg-sub", text: "Click the map to drop a marker" }));

    const board = el("div", { class: "zgm-board" });
    if (map.img) {
      board.appendChild(el("img", { class: "zgm-img", src: map.img, alt: "" }));
    } else {
      board.appendChild(el("div", { class: "zgm-noimg", text: "Give the map an image first." }));
    }

    board.addEventListener("click", ev => {
      // Clicking a pin selects it; only the bare board places a new one.
      if (ev.target.closest(".zgm-pin")) return;
      if (!map.img) return ui.notifications.warn("Give the map an image first.");
      const r = board.getBoundingClientRect();
      if (!r.width || !r.height) return;
      map.pins.push({
        id: uid("pin"),
        x: Math.round(((ev.clientX - r.left) / r.width) * 1000) / 10,
        y: Math.round(((ev.clientY - r.top) / r.height) * 1000) / 10,
        label: "", note: "", icon: "fa-location-dot", img: "", found: true,
      });
      setMaps(maps).then(() => this.render());
    });

    for (const p of map.pins) {
      const dot = el("button", {
        class: "zgm-pin" + (p.found === false ? " hidden" : ""),
        type: "button",
        title: p.label || "Unlabelled marker",
        html: `<i class="fa-solid ${p.icon || "fa-location-dot"}"></i>`,
        onclick: ev => {
          ev.preventDefault();
          ev.stopPropagation();
          document.getElementById("zg-pin-" + p.id)?.scrollIntoView({ block: "center" });
        },
      });
      dot.style.left = `${p.x}%`;
      dot.style.top = `${p.y}%`;
      board.appendChild(dot);
    }
    body.appendChild(board);

    // --- the markers ---
    for (const p of map.pins) {
      const wrap = el("div", { class: "zgm-pinrow", id: "zg-pin-" + p.id });

      const top = el("div", { class: "zg-arow" });
      const lab = el("input", { value: p.label ?? "", placeholder: "Label" });
      lab.oninput = () => p.label = lab.value;
      const ico = el("input", { value: p.icon ?? "fa-location-dot", placeholder: "fa-location-dot" });
      ico.oninput = () => p.icon = ico.value;
      top.append(lab, ico, el("button", {
        class: "zg-rm", html: '<i class="fa-solid fa-xmark"></i>',
        onclick: async ev => {
          ev.preventDefault();
          map.pins = map.pins.filter(x => x.id !== p.id);
          await setMaps(maps);
          this.render();
        },
      }));
      wrap.appendChild(top);

      const mid = el("div", { class: "zg-arow" });
      const pimg = el("input", { value: p.img ?? "", placeholder: "Photo of the place (optional)" });
      pimg.oninput = () => p.img = pimg.value;
      mid.appendChild(pimg);
      const pb = pickFile(path => { pimg.value = path; p.img = path; });
      if (pb) mid.appendChild(pb);
      wrap.appendChild(mid);

      const note = el("textarea", { rows: "2", placeholder: "What they find here" });
      note.value = p.note ?? "";
      note.oninput = () => p.note = note.value;
      wrap.appendChild(note);

      const found = el("input", { type: "checkbox" });
      found.checked = p.found !== false;
      found.onchange = () => found.checked ? (p.found = true) : (p.found = false);
      const fRow = el("label", { class: "zg-check" });
      fRow.append(found, el("span", { text: "The party has found this — leave it off to keep it hidden" }));
      wrap.appendChild(fRow);

      body.appendChild(wrap);
    }

    if (!map.pins.length) {
      body.appendChild(el("div", { class: "zg-hint", text: "No markers on this map yet." }));
    }

    this._save(body, commit);

    body.appendChild(el("button", {
      class: "zg-rm zg-wide", html: '<i class="fa-solid fa-trash"></i> Delete this map',
      onclick: async ev => {
        ev.preventDefault();
        if (!await confirmDialog("Delete Map", `Delete "${map.name}" and its markers?`)) return;
        await setMaps(maps.filter(m => m.id !== map.id));
        this.mapSel = null;
        this.render();
      },
    }));
  }

  // -------------------------------------------------------------------------
  //  QUEUE  (messages written in advance, sent by hand)
  // -------------------------------------------------------------------------

  /**
   * Messages prepared before the session and fired on the beat.
   *
   * Deliberately not scheduled against the world clock: a GM who has written the
   * session's beats wants them to land *on the beat*, not at a timestamp guessed
   * the night before. So each of these sits here until its button is pressed —
   * and stays afterwards, with a count, because the good ones get used again.
   */
  _gm_queue(body) {
    const queue = getQueued().map(q => ({ ...q, to: q.to === "all" ? "all" : [...(q.to ?? [])] }));
    const students = game.users.filter(u => !u.isGM && u.character).map(u => u.character);

    body.appendChild(el("div", {
      class: "zg-hint",
      text: "Write them now, send them when the moment arrives. Nothing here goes out on its own.",
    }));

    for (const q of queue) {
      const card = el("div", { class: "zgq-card" });

      const head = el("div", { class: "zg-arow" });
      const from = el("input", { value: q.from ?? "", placeholder: "From (NPC name)" });
      from.oninput = () => q.from = from.value;
      const label = el("input", { value: q.label ?? "", placeholder: "Label, for you" });
      label.oninput = () => q.label = label.value;
      head.append(from, label, el("button", {
        class: "zg-rm", html: '<i class="fa-solid fa-xmark"></i>',
        onclick: async ev => {
          ev.preventDefault();
          await setQueued(queue.filter(x => x.id !== q.id));
          this.render();
        },
      }));
      card.appendChild(head);

      const text = el("textarea", { rows: "3", placeholder: "What they say" });
      text.value = q.text ?? "";
      text.oninput = () => q.text = text.value;
      card.appendChild(text);

      const imgRow = el("div", { class: "zg-arow" });
      const img = el("input", { value: q.image ?? "", placeholder: "Attached image (optional)" });
      img.oninput = () => q.image = img.value;
      imgRow.appendChild(img);
      const b = pickFile(path => { img.value = path; q.image = path; });
      if (b) imgRow.appendChild(b);
      card.appendChild(imgRow);

      // --- who gets it ---
      const toRow = el("div", { class: "zgq-to" });
      const all = el("input", { type: "checkbox" });
      all.checked = q.to === "all";
      const allRow = el("label", { class: "zg-check" });
      allRow.append(all, el("span", { text: "Everyone" }));
      toRow.appendChild(allRow);

      const boxes = [];
      for (const a of students) {
        const cb = el("input", { type: "checkbox" });
        cb.checked = q.to !== "all" && q.to.includes(a.id);
        cb.disabled = all.checked;
        cb.onchange = () => {
          const picked = boxes.filter(x => x.cb.checked).map(x => x.id);
          q.to = picked;
        };
        boxes.push({ cb, id: a.id });
        const row = el("label", { class: "zg-check" });
        row.append(cb, el("span", { text: a.name }));
        toRow.appendChild(row);
      }
      all.onchange = () => {
        for (const x of boxes) x.cb.disabled = all.checked;
        q.to = all.checked ? "all" : boxes.filter(x => x.cb.checked).map(x => x.id);
      };
      card.appendChild(toRow);

      // --- send ---
      const foot = el("div", { class: "zgq-foot" });
      foot.appendChild(el("button", {
        class: "zgq-send", html: '<i class="fa-solid fa-paper-plane"></i> Send now',
        onclick: async ev => {
          ev.preventDefault();
          await setQueued(queue);            // save the edits before firing them
          const n = await sendQueued(q.id);
          if (n) this.render();
        },
      }));
      foot.appendChild(el("div", {
        class: "zgq-sent",
        text: q.sentCount
          ? `Sent ${q.sentCount}×, last ${relTime(q.lastSent) || "just now"} ago`
          : "Never sent",
      }));
      card.appendChild(foot);

      body.appendChild(card);
    }

    if (!queue.length) {
      body.appendChild(el("div", { class: "zg-hint", text: "Nothing queued." }));
    }

    body.appendChild(el("button", {
      class: "zg-add", html: '<i class="fa-solid fa-plus"></i> New queued message',
      onclick: async ev => {
        ev.preventDefault();
        queue.push({ id: uid("q"), label: "", from: "", text: "New message", image: "", to: "all" });
        await setQueued(queue);
        this.render();
      },
    }));

    this._save(body, async () => {
      await setQueued(queue);
      ui.notifications.info("Queue saved.");
    });
  }

  // -------------------------------------------------------------------------
  //  NOTICES  (world content — C1)
  // -------------------------------------------------------------------------

  /**
   * The school notice board.
   *
   * As of v1.7 this is world content, not per-actor: one list, read by every
   * student. That is why there is no "push to all" button any more — there is
   * nothing to push, and editing a notice here changes it everywhere at once
   * instead of leaving every player holding a stale copy.
   *
   * Dismissals stay per-actor, because which notices *I* have cleared is
   * genuinely personal.
   */
  _gm_announce(body) {
    const anns = getAnnouncements().map(a => ({ ...a }));
    const ct = el("div", { class: "zg-arr" });

    const draw = () => {
      ct.innerHTML = "";
      anns.forEach((a, i) => {
        const r = el("div", { class: "zg-arow" });

        const pin = el("button", {
          class: "zg-pin" + (a.pinned ? " on" : ""),
          html: '<i class="fa-solid fa-thumbtack"></i>',
          title: a.pinned ? "Pinned to the top" : "Pin to the top",
          onclick: () => { anns[i].pinned = !anns[i].pinned; draw(); },
        });

        const t = el("input", { value: a.text ?? "", placeholder: "Notice text" });
        t.oninput = () => anns[i].text = t.value;

        const tm = el("input", { value: a.time ?? "", placeholder: "Time", style: { maxWidth: "110px" } });
        tm.oninput = () => anns[i].time = tm.value;

        r.append(pin, t, tm, el("button", {
          class: "zg-rm", html: '<i class="fa-solid fa-xmark"></i>', title: "Remove",
          onclick: () => { anns.splice(i, 1); draw(); },
        }));
        ct.appendChild(r);
      });
      if (!anns.length) ct.appendChild(el("div", { class: "zg-hint", text: "The board is empty." }));
    };
    draw();
    body.appendChild(ct);

    body.appendChild(el("button", {
      class: "zg-add", html: '<i class="fa-solid fa-plus"></i> Add Notice',
      onclick: () => {
        anns.push({ id: annId(), text: "", time: getAutoTime(), pinned: false, ts: Date.now() });
        draw();
      },
    }));

    body.appendChild(el("div", {
      class: "zg-hint",
      text: "Notices are world-wide. Every student sees this list; each clears their own.",
    }));

    this._save(body, async () => {
      // Backfill ids in place so repeated saves reuse the SAME id and nobody's
      // dismissals slide onto the wrong row.
      for (const a of anns) if (!a.id) a.id = annId();
      await setAnnouncements(anns);
      ui.notifications.info("Notice board updated.");
      app.ui?.refresh();
    });

    body.appendChild(el("div", { class: "zg-divider" }));
    body.appendChild(el("button", {
      class: "zg-add", text: "Notify Every Student",
      title: "Drop a 'new notices' card into every student's notification centre",
      onclick: async () => {
        for (const a of studentActors()) {
          await pushNotification(a, {
            icon: "fa-bullhorn", title: "Notice board updated",
            body: "New notices have been posted.", app: "notices",
          });
        }
        ui.notifications.info("Students notified.");
      },
    }));

    body.appendChild(el("div", { class: "zg-divider" }));
    body.appendChild(el("button", {
      class: "zg-add", text: "Restore Everyone's Dismissed Notices",
      onclick: async () => {
        for (const a of studentActors()) {
          const s = loadSection(a, F.system);
          s.dismissedAnnouncements = [];
          await saveSection(a, F.system, s);
        }
        ui.notifications.info("Restored for all students.");
        app.ui?.refresh();
      },
    }));
  }

  // -------------------------------------------------------------------------
  //  CALENDAR  (world content — C1)
  // -------------------------------------------------------------------------

  /**
   * School events, world-scope. The device counts down to the soonest one that
   * has not already passed, so a list can be filled in ahead of a term and left
   * alone rather than re-pushed every session.
   */
  _gm_event(body) {
    const evts = getEvents().map(e => ({ ...e }));
    const ct = el("div", { class: "zg-arr" });

    const draw = () => {
      ct.innerHTML = "";
      const ordered = [...evts].sort((a, b) => (Number(a.days) || 0) - (Number(b.days) || 0));
      const soonest = ordered.find(e => e.name && (Number(e.days) || 0) >= 0);

      evts.forEach((e, i) => {
        const r = el("div", { class: "zg-arow" });

        const n = el("input", { value: e.name ?? "", placeholder: "Event name" });
        n.oninput = () => evts[i].name = n.value;

        const dy = el("input", {
          type: "number", value: e.days ?? 0, placeholder: "Days",
          style: { maxWidth: "90px" },
        });
        dy.oninput = () => { evts[i].days = Number(dy.value) || 0; badge.textContent = daysLabel(evts[i].days); };

        const badge = el("span", {
          class: "zg-daybadge" + (e === soonest ? " next" : ""),
          text: daysLabel(e.days ?? 0),
        });

        r.append(n, dy, badge, el("button", {
          class: "zg-rm", html: '<i class="fa-solid fa-xmark"></i>', title: "Remove",
          onclick: () => { evts.splice(i, 1); draw(); },
        }));
        ct.appendChild(r);
      });
      if (!evts.length) ct.appendChild(el("div", { class: "zg-hint", text: "No events scheduled." }));
    };
    draw();
    body.appendChild(ct);

    body.appendChild(el("button", {
      class: "zg-add", html: '<i class="fa-solid fa-plus"></i> Add Event',
      onclick: () => { evts.push({ id: evtId(), name: "", days: 0, detail: "" }); draw(); },
    }));

    body.appendChild(el("div", {
      class: "zg-hint",
      text: "0 = today. The soonest event that hasn't passed is the one the scroll counts down to.",
    }));

    this._save(body, async () => {
      for (const e of evts) if (!e.id) e.id = evtId();
      await setEvents(evts);
      ui.notifications.info("Calendar updated.");
      app.ui?.refresh();
    });
  }

  // -------------------------------------------------------------------------
  //  DANGER ZONE
  // -------------------------------------------------------------------------

  /**
   * Export, and the passphrase-locked clear.
   *
   * Be clear about what the passphrase is: a misclick guard, not security. World
   * settings sync to every connected client, so it is stored as a salted hash
   * and never in plain text — but anyone with GM rights and a browser console
   * can bypass this dialog entirely. What actually stops a player wiping the
   * campaign is Foundry's permission model: a player cannot write another
   * actor's flags at all. This stops *you* doing it by accident at 1am.
   *
   * Which is why the export is offered first and recommended in as many words.
   * It is the only real undo.
   */
  _gm_danger(body) {
    if (!game.user.isGM) {
      body.appendChild(el("div", { class: "zg-hint", text: "GM only." }));
      return;
    }

    let stored = {};
    try { stored = game.settings.get(M, "resetHash") ?? {}; } catch (e) { /* unregistered */ }
    const armed = !!(stored.hash && stored.salt);

    const sum = scrollDataSummary();
    const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

    // --- 1. export ---
    body.appendChild(el("div", { class: "zg-sub", text: "1 · Back Up First" }));
    body.appendChild(el("div", {
      class: "zg-hint",
      text: `${plural(sum.actors, "actor")} hold scroll data: ` +
            `${plural(sum.messages, "message")}, ${plural(sum.contacts, "contact")}, ` +
            `${plural(sum.images, "gallery image")}, ${plural(sum.notifications, "alert")}.`,
    }));

    const withWorld = el("input", { type: "checkbox" });
    withWorld.checked = true;
    const wRow = el("label", { class: "zg-check" });
    wRow.append(withWorld, el("span", { text: "Include the notice board and calendar in the export" }));
    body.appendChild(wRow);

    body.appendChild(el("button", {
      class: "zg-add", html: '<i class="fa-solid fa-download"></i> Export All Scroll Data (JSON)',
      onclick: () => {
        const data = exportScrollData({ includeWorld: withWorld.checked });
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
        this._download(`zenith-scroll-backup-${stamp}.json`, JSON.stringify(data, null, 2));
        ui.notifications.info("Backup downloaded.");
      },
    }));
    body.appendChild(el("div", {
      class: "zg-hint",
      text: "Take the backup. It is the only undo a clear has.",
    }));

    // --- 2. passphrase ---
    body.appendChild(el("div", { class: "zg-divider" }));
    body.appendChild(el("div", { class: "zg-sub", text: "2 · Passphrase" }));
    body.appendChild(el("div", {
      class: "zg-hint",
      text: armed
        ? "A passphrase is set. It is stored as a salted hash, never in plain text."
        : "No passphrase set. Set one before the clear below will run.",
    }));

    const p1 = el("input", { type: "password", placeholder: armed ? "New passphrase" : "Passphrase" });
    const p2 = el("input", { type: "password", placeholder: "Repeat it" });
    const pRow = el("div", { class: "zg-arow" });
    pRow.append(p1, p2, el("button", {
      class: "zg-add", text: armed ? "Change" : "Set",
      onclick: async () => {
        const v = p1.value;
        if (v.length < 4) return ui.notifications.warn("Use at least 4 characters.");
        if (v !== p2.value) return ui.notifications.warn("The two passphrases do not match.");
        const salt = makeSalt();
        const hash = await hashPassphrase(v, salt);
        await game.settings.set(M, "resetHash", { salt, hash, setAt: Date.now() });
        p1.value = p2.value = "";
        ui.notifications.info("Passphrase saved.");
        this.render();
      },
    }));
    body.appendChild(pRow);

    body.appendChild(el("div", {
      class: "zg-hint",
      text: "This is a misclick guard, not security: anyone with GM rights and a " +
            "console can bypass it. What stops a player wiping the campaign is that " +
            "Foundry will not let them write another actor's flags at all.",
    }));

    // --- 3. the clear ---
    body.appendChild(el("div", { class: "zg-divider" }));
    body.appendChild(el("div", { class: "zg-sub zg-dhead", text: "3 · Clear All Scroll Data" }));

    const alsoWorld = el("input", { type: "checkbox" });
    const awRow = el("label", { class: "zg-check" });
    awRow.append(alsoWorld, el("span", {
      text: "Also clear the notice board and calendar — off by default, because that " +
            "is the school's content rather than anything a scroll holds",
    }));
    body.appendChild(awRow);

    body.appendChild(el("button", {
      class: "zg-danger",
      html: '<i class="fa-solid fa-triangle-exclamation"></i> Clear All Scroll Data',
      onclick: () => this._confirmClear({ includeWorld: alsoWorld.checked }),
    }));
    body.appendChild(el("div", {
      class: "zg-hint",
      text: "Removes the profile, academic, social, media, system and prefs flags from " +
            "every actor. Flags are unset rather than emptied, so the actors come " +
            "back genuinely clean.",
    }));
  }

  /**
   * The confirmation itself: the passphrase, and typing DELETE.
   *
   * Two locks rather than one because they fail differently — the passphrase
   * stops someone who is not you, and typing the word stops you when you are
   * tired and clicking through dialogs. Both are shown against what is actually
   * about to be removed, because "clear all scroll data" means nothing until you
   * know it is fourteen actors and three hundred messages.
   */
  async _confirmClear({ includeWorld }) {
    let record = {};
    try { record = game.settings.get(M, "resetHash") ?? {}; } catch (e) { /* unregistered */ }
    if (!record.hash) return ui.notifications.warn("Set a passphrase first.");

    const sum = scrollDataSummary();
    const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
    const content =
      `<p><strong>This removes every scroll flag from ${plural(sum.actors, "actor")}.</strong></p>` +
      `<p>${plural(sum.messages, "message")}, ${plural(sum.contacts, "contact")}, ` +
      `${plural(sum.images, "gallery image")} and ${plural(sum.notifications, "alert")} will be gone.` +
      (includeWorld ? " The notice board and calendar will be cleared too." : "") +
      `</p><p>There is no undo but the backup.</p>` +
      `<p><label>Passphrase<br><input type="password" name="pass" autocomplete="off"/></label></p>` +
      `<p><label>Type <code>DELETE</code> to confirm<br><input type="text" name="word" autocomplete="off"/></label></p>`;

    const D = foundry.applications?.api?.DialogV2;
    if (!D?.prompt) return ui.notifications.error("This dialog needs Foundry v13 or later.");

    let answer = null;
    try {
      answer = await D.prompt({
        window: { title: "Clear All Scroll Data" },
        content,
        modal: true,
        ok: {
          label: "Clear Everything",
          callback: (_ev, _btn, dialog) => {
            const root = dialog?.element ?? dialog;
            return {
              pass: root?.querySelector?.('[name="pass"]')?.value ?? "",
              word: root?.querySelector?.('[name="word"]')?.value ?? "",
            };
          },
        },
      });
    } catch (e) {
      return;   // dismissed
    }
    if (!answer) return;

    if (String(answer.word).trim() !== "DELETE") {
      return ui.notifications.warn("Not cleared: you did not type DELETE.");
    }
    if (!await verifyPassphrase(answer.pass, record)) {
      return ui.notifications.error("Not cleared: wrong passphrase.");
    }

    const n = await clearScrollData({ includeWorld });
    ui.notifications.info(`Cleared scroll data from ${plural(n, "actor")}.`);
    app.ui?.close?.();
    app.icon?.badge?.(0);
    this.render();
  }

  /**
   * Hand the GM a file.
   *
   * A blob URL and a synthetic click: Foundry has no "save this string" helper,
   * and writing into the userdata directory would need a server route the module
   * does not have.
   */
  _download(name, text) {
    try {
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const a = el("a", { href: url, download: name });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      console.error(`${M} | download failed`, e);
      ui.notifications.error("Could not build the download. See the console.");
    }
  }
}
