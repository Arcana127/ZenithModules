/**
 * Zenith Academy Scroll — visual preview builder
 *
 *   node tests/render-preview.mjs [outfile]
 *
 * Renders every view through the *real* ScrollUI against the same fake DOM the
 * smoke test uses, serialises the result to HTML, and writes one page holding
 * every view at three panel heights, styled by the real stylesheet.
 *
 * This exists because the smoke test cannot catch a layout bug. It renders views
 * and asserts structure, not geometry — it had nothing to say about the egg-
 * shaped bracelet, the Pro-only icon, or the lock screen slicing its own unlock
 * button in half, all three of which were found by looking at a browser. Open
 * the output, look at it, and resize.
 *
 * The heights are the ones that mattered: 880 is the nominal panel, 640 is a
 * 1080p Foundry window after the vh clamp, and 520 is the case that was broken.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const OUT = process.argv[2] ?? path.join(HERE, "preview.html");

const PANEL_HEIGHTS = [880, 640, 520];

// ---------------------------------------------------------------- fake DOM
// Deliberately a separate, simpler copy from the smoke test's: this one has to
// serialise, which the test's does not, and coupling them would make the test
// harder to read for no benefit.

const VOID = new Set(["img", "input", "br", "hr", "source"]);
let activeElement = null;

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function matches(node, sel) {
  const parts = sel.trim().match(/^([a-z0-9]+)?((?:[.#][\w-]+|\[[^\]]+\])*)$/i);
  if (!parts) return false;
  if (parts[1] && node.tagName !== parts[1]) return false;
  for (const tok of parts[2].match(/[.#][\w-]+|\[[^\]]+\]/g) ?? []) {
    if (tok[0] === ".") {
      if (!String(node.className).split(/\s+/).includes(tok.slice(1))) return false;
    } else if (tok[0] === "#") {
      if (node.attrs.id !== tok.slice(1)) return false;
    } else {
      const m = tok.slice(1, -1).match(/^([\w-]+)(?:=["']?([^"']*)["']?)?$/);
      if (!m) return false;
      const have = node.attrs[m[1]];
      if (have === undefined) return false;
      if (m[2] !== undefined && String(have) !== m[2]) return false;
    }
  }
  return true;
}

function walk(node, fn) {
  for (const c of node.children) { fn(c); walk(c, fn); }
}

function makeEl(tag) {
  const n = {
    tagName: tag, className: "", _text: "", innerHTML: "", children: [], parent: null,
    dataset: {}, attrs: {}, value: "", checked: false, selected: false,
    scrollTop: 0, scrollHeight: 0,
    _style: {},
    /*
     * A Proxy, not a plain object with a setProperty method.
     *
     * `el()` writes inline styles two ways: `setProperty` for custom properties
     * and `Object.assign(el.style, {...})` for ordinary ones. A stub that only
     * implements setProperty silently swallows the second kind, and the preview
     * then lies -- the relationship marker rendered at 0% instead of 80%, which
     * looks exactly like a real bug. Trapping sets catches both.
     */
    style: new Proxy({
      setProperty(k, v) { n._style[k] = v; },
      get cssText() { return ""; },
    }, {
      set(t, k, v) {
        if (typeof k === "string") n._style[k.replace(/[A-Z]/g, c => "-" + c.toLowerCase())] = v;
        return true;
      },
    }),
    appendChild(c) { if (c) { c.parent = this; this.children.push(c); } return c; },
    append(...cs) { for (const c of cs) if (c && typeof c !== "string") this.appendChild(c); },
    replaceChildren(...cs) { this.children = []; for (const c of cs) this.appendChild(c); },
    remove() {
      const i = this.parent?.children.indexOf(this);
      if (i >= 0) this.parent.children.splice(i, 1);
      this.parent = null;
    },
    replaceWith(other) {
      const i = this.parent?.children.indexOf(this);
      if (i >= 0) { other.parent = this.parent; this.parent.children[i] = other; }
      this.parent = null;
    },
    contains(o) { for (let p = o; p; p = p.parent) if (p === this) return true; return false; },
    closest(sel) { for (let p = this; p; p = p.parent) if (matches(p, sel)) return p; return null; },
    querySelector(sel) { let hit = null; walk(this, c => { if (!hit && matches(c, sel)) hit = c; }); return hit; },
    querySelectorAll(sel) { const o = []; walk(this, c => { if (matches(c, sel)) o.push(c); }); return o; },
    addEventListener() {}, removeEventListener() {},
    setAttribute(k, v) {
      this.attrs[k] = v;
      // A real element mirrors class onto className, and SVG is built through
      // setAttribute rather than el()'s `class` shortcut.
      if (k === "class") this.className = v;
      if (k.startsWith("data-")) this.dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v;
    },
    focus() { activeElement = this; },
    setSelectionRange() {},
    // A plausible rect, so the emitter guard and the tooltip placer both take a
    // real branch rather than the headless one.
    getBoundingClientRect() { return { left: 40, top: 40, right: 104, bottom: 104, width: 64, height: 64 }; },
    get firstElementChild() { return this.children[0] ?? null; },
    get classList() {
      const self = this;
      const list = () => String(self.className).split(/\s+/).filter(Boolean);
      return {
        add(...cs) { self.className = [...new Set([...list(), ...cs])].join(" "); },
        remove(...cs) { self.className = list().filter(c => !cs.includes(c)).join(" "); },
        contains(c) { return list().includes(c); },
        toggle(c, on) { on ? this.add(c) : this.remove(c); },
      };
    },
  };
  Object.defineProperty(n, "textContent", { get() { return this._text; }, set(v) { this._text = v; } });
  return n;
}

/** Serialise a fake node back to real HTML. */
function html(node) {
  const tag = node.tagName;
  const attrs = [];
  if (node.className) attrs.push(`class="${esc(node.className)}"`);
  for (const [k, v] of Object.entries(node.attrs)) {
    if (k === "class") continue;
    attrs.push(`${k}="${esc(v)}"`);
  }
  const style = Object.entries(node._style).map(([k, v]) => `${k}:${v}`).join(";");
  if (style) attrs.push(`style="${esc(style)}"`);
  if (node.value) attrs.push(`value="${esc(node.value)}"`);
  /*
   * `selected` and `checked` are set as properties, not attributes, so without
   * these two lines every `<select>` in the preview shows its first option and
   * every checkbox shows unticked -- the relationship ranks all read "-5
   * Nemesis" regardless of the fixture. A preview that quietly misreports state
   * is worse than no preview, because it invites a hunt for a bug that is not
   * in the module.
   */
  if (node.selected) attrs.push("selected");
  if (node.checked) attrs.push("checked");

  const open = `<${tag}${attrs.length ? " " + attrs.join(" ") : ""}>`;
  if (VOID.has(tag)) return open;

  const inner = (node.innerHTML || "") + esc(node._text) + node.children.map(html).join("");
  return `${open}${inner}</${tag}>`;
}

const body = makeEl("body");
globalThis.document = {
  createElement: makeEl,
  // The Gift editor's edges are real SVG; without this the board renders as an
  // error card and the preview goes on being kinder than the app.
  createElementNS: (_ns, tag) => makeEl(tag),
  body,
  getElementById(id) { let hit = null; walk(body, c => { if (!hit && c.attrs.id === id) hit = c; }); return hit; },
  querySelector: sel => body.querySelector(sel),
  addEventListener() {}, removeEventListener() {},
  get activeElement() { return activeElement; },
};
globalThis.window = { matchMedia: () => ({ matches: false }), innerWidth: 1600, innerHeight: 900 };
globalThis.innerWidth = 1600;
globalThis.innerHeight = 900;
globalThis.CSS = { escape: s => String(s).replace(/["\\]/g, "\\$&") };

// ------------------------------------------------------------ fake Foundry
globalThis.Hooks = { once() {}, on() {} };
globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
globalThis.foundry = { applications: { api: {} } };
globalThis.canvas = { tokens: { controlled: [] } };

function makeItem(name, quantity) {
  return { name, system: { quantity }, async update() {} };
}

function makeActor(name, flags = {}) {
  return {
    id: "actor-" + name.toLowerCase().replace(/\W/g, ""), name,
    img: PORTRAIT(name), prototypeToken: { texture: { src: TOKEN(name) } },
    isOwner: true, items: [], _flags: flags,
    getFlag(_m, k) { return this._flags[k]; },
    async update(data) { Object.assign(this._flags, data.flags["zenith-scroll"]); },
    async unsetFlag(_m, k) { delete this._flags[k]; },
    testUserPermission() { return true; },
  };
}

/*
 * Inline SVG stand-ins for artwork. The module ships no binary assets and the
 * preview must not either, but a portrait frame with a broken image in it tells
 * you nothing about whether the frame is the right shape.
 */
const svgData = (bg, label) =>
  "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">` +
    `<rect width="200" height="200" fill="${bg}"/>` +
    `<text x="100" y="112" font-family="sans-serif" font-size="34" fill="#fff" ` +
    `text-anchor="middle">${label}</text></svg>`);

const TOKEN = n => svgData("#2c5f6e", n.split(" ").map(w => w[0]).join(""));
const PORTRAIT = n => svgData("#5b3a94", n.split(" ").map(w => w[0]).join(""));

const settings = {
  enablePlayerMessaging: true,
  galleryFolder: "scroll-gallery",
  marksItemName: "marks",
  useTokenImages: true,
  currencies: [
    { key: "marks", itemName: "marks", label: "Marks", icon: "fa-coins", tint: "#e0c050", primary: true },
    { key: "astras", itemName: "astras", label: "Astras", icon: "fa-star", tint: "#a6f2fb", primary: false },
  ],
  resetHash: {},
  worldAnnouncements: [
    { id: "a1", text: "Duelling hall closed for repairs until the end of term.", time: "8:00 AM", pinned: true },
    { id: "a2", text: "Second Examination sign-up closes at fifth bell.", time: "9:15 AM", pinned: false },
  ],
  worldEvents: [{ id: "e1", name: "Second Examination", days: 3, detail: "" }],
  worldContentSeeded: true,
  schemaVersion: 2,
};

const actors = [];
globalThis.game = {
  actors: Object.assign(actors, {
    get: id => actors.find(a => a.id === id),
    getName: n => actors.find(a => a.name === n),
  }),
  users: Object.assign([], { get: id => null }),
  user: { isGM: false, id: "u1", character: null, getFlag: () => null, setFlag: () => {} },
  settings: { register() {}, get(_m, k) { return settings[k]; }, async set(_m, k, v) { settings[k] = v; } },
  time: { worldTime: 46_800 },
  modules: { get: () => null },
  socket: { on() {}, emit() {} },
  world: { id: "preview" },
};

// ----------------------------------------------------------- the fixture
const { ScrollUI } = await import("../scripts/ui-scroll.mjs");
const { APPS } = await import("../scripts/core.mjs");

const me = makeActor("Rin Adler");
const hale = makeActor("Prof. Hale");
const kira = makeActor("Kira Senn");
const otto = makeActor("Otto Brand");
actors.push(me, hale, kira, otto);

me.items = [makeItem("marks", 128), makeItem("astras", 42)];

const now = Date.now();
me._flags = {
  profile: {
    studentId: "ZA-K7M2PQR", year: 2, cohort: "Ardent Cohort",
    dormitory: "Ashfall House", status: "Reading up on wardcraft.", statusPreset: "available",
  },
  academic: {
    schedule: [
      { period: "First Bell", course: "Applied Rites", instructor: "Prof. Hale", location: "West Hall" },
      { period: "Second Bell", course: "Aether Theory", instructor: "Prof. Sen", location: "Observatory" },
      { period: "Third Bell", course: "Duelling Forms", instructor: "Coach Brand", location: "The Pit" },
    ],
    gift: "Emberwake", giftDescription: "<em>A slow-burning flame that answers to patience.</em>",
    giftLevel: 3,
    giftMilestones: [
      { name: "First Spark", achieved: true },
      { name: "Held the Line", achieved: true },
      { name: "Kindled Another", achieved: false },
    ],
    notes: "<b>Note:</b> flagged for the wardcraft elective.",
  },
  social: {
    conversations: [
      {
        id: "c1", participants: ["Rin Adler", "Prof. Hale"], title: null, isGroup: false, muted: false,
        messages: [
          { from: "Prof. Hale", text: "Report to my office after third bell.", time: "1:05 PM", ts: now - 7_200_000, read: true, sent: false },
          { from: "Rin Adler", text: "Understood. Should I bring the ward diagrams?", time: "1:07 PM", ts: now - 7_000_000, read: true, sent: true },
          { from: "Prof. Hale", text: "Bring all of them. And be on time this once.", time: "1:09 PM", ts: now - 900_000, read: false, sent: false },
        ],
      },
      {
        id: "c2", participants: ["Rin Adler", "Kira Senn"], title: null, isGroup: false, muted: true,
        messages: [{ from: "Kira Senn", text: "Are you coming to the duelling hall or not?", time: "12:40 PM", ts: now - 10_800_000, read: true, sent: false }],
      },
    ],
    relationships: [
      { name: "Prof. Hale", title: "Instructor, Applied Rites", img: TOKEN("Prof. Hale"), rank: 3, category: "Faculty", history: ["Neutral → Cordial: Covered for her in the west hall"], notes: "Fair, but keeps score." },
      { name: "Kira Senn", title: "Second Year", img: TOKEN("Kira Senn"), rank: 5, category: "Students", history: [], notes: "" },
      { name: "Otto Brand", title: "Duelling Coach", img: TOKEN("Otto Brand"), rank: -2, category: "Faculty", history: [], notes: "" },
    ],
  },
  media: { gallery: [{ src: PORTRAIT("Field Trip"), caption: "Field trip to the eastern spire" }] },
  system: {
    dismissedAnnouncements: [],
    notifications: [
      { id: "n1", icon: "fa-comment-dots", title: "Prof. Hale", body: "Bring all of them. And be on time this once.", app: "messages", ts: now - 900_000, read: false },
      { id: "n2", icon: "fa-coins", title: "+42 Astras", body: "Tournament prize", app: "bank", ts: now - 86_400_000, read: true },
      { id: "n3", icon: "fa-bullhorn", title: "New notice", body: "Duelling hall closed for repairs until the end of term.", app: "notices", ts: now - 172_800_000, read: true },
    ],
    ledger: [
      { id: "l1", currency: "astras", delta: 42, balance: 42, reason: "Tournament prize", ts: now - 86_400_000 },
      { id: "l2", currency: "marks", delta: -12, balance: 128, reason: "Replacement wand", ts: now - 259_200_000 },
    ],
  },
  prefs: { deviceName: "", accent: "aether", reduceMotion: false, skipLock: false },
};

// ------------------------------------------------------------- render them
function render(method) {
  const ui = new ScrollUI();
  ui.actor = me;
  const ct = makeEl("div");
  ct.className = "zsu-view";
  ui[method](ct);
  return html(ct);
}

/*
 * A tree to look at, set up before anything renders.
 *
 * Both halves of the Gift feature are a shape rather than a form — the
 * student's board and the GM's editor — and an empty board would tell us
 * nothing about whether the shape reads. It has to be assigned here rather
 * than down in the Command Center section, or the device's own Gift pane
 * renders first and falls back to the v1.8 milestone track.
 */
const { setGiftTrees } = await import("../scripts/world.mjs");
const { assignGiftTrees, grantGiftPoints } = await import("../scripts/data.mjs");
const { unlockGiftNode } = await import("../scripts/gift.mjs");

{
  const wasGM = game.user.isGM;
  game.user.isGM = true;
  await setGiftTrees([{
    id: "core", name: "Awakening", nodes: [
      { id: "n0", name: "Awakened", kind: "milestone", cost: 0, requires: [], x: 50, y: 10,
        description: "The morning the stone first answered you." },
      { id: "n1", name: "Reach", kind: "buff", cost: 1, requires: ["n0"], x: 27.5, y: 37.5,
        description: "The edge of what you can touch moves further out than it should.",
        effect: "+10 feet to the range of any Gift effect." },
      // The one a student can afford in the preview, so the sheet shows the
      // control that actually spends something.
      { id: "n2", name: "Focus", kind: "buff", cost: 1, requires: ["n0"], x: 72.5, y: 37.5,
        description: "Noise falls away. What you meant to do is the only thing that happens.",
        effect: "Ignore the first source of concealment each round.",
        grants: [{ uuid: "Compendium.pf2e.feats-srd.Item.EXAMPLE", name: "Steady Focus" }] },
      { id: "n3", name: "Second Skin", kind: "freeform", cost: 2, requires: ["n1"], x: 20, y: 65,
        description: "It stops being a thing you do and starts being a thing you are.",
        effect: "Maintain one Gift effect without spending an action." },
      { id: "n4", name: "The Long Note", kind: "capstone", cost: 3, requires: ["n2"], x: 75, y: 75,
        description: "One sound, held until everything else agrees with it.",
        effect: "Once per day, extend a Gift effect to the end of the scene.",
        grants: [{ uuid: "Compendium.pf2e.feats-srd.Item.EXAMPLE", name: "The Long Note" }] },
    ],
  }]);
  game.user.isGM = wasGM;

  await assignGiftTrees(me, ["core"]);
  await grantGiftPoints(me, 2, "Preview");
  // One taken node and one lit edge, so both edge states are on screen.
  await unlockGiftNode(me, "core:n0");
  await unlockGiftNode(me, "core:n1");
}

const VIEWS = [
  ["Lock screen", "_view_lock"],
  ["Home", "_view_home"],
  ...APPS.map(a => [a.label, "_app_" + a.id]),
];

// The Messages thread and the contact detail are in-app states, not apps.
function renderState(method, patch) {
  const ui = new ScrollUI();
  ui.actor = me;
  Object.assign(ui, patch);
  const ct = makeEl("div");
  ct.className = "zsu-view";
  ui[method](ct);
  return html(ct);
}

const panes = [];
for (const [label, method] of VIEWS) {
  panes.push([label, render(method)]);
}
panes.push(["Messages · thread", renderState("_app_messages", { convId: "c1" })]);
panes.push(["Contacts · detail", renderState("_app_contacts", { relContact: "Prof. Hale" })]);
// The node sheet is an in-app state over the board, and carries the one control
// on the whole screen that spends something.
panes.push(["Gift · node sheet", renderState("_app_gift", { giftNode: "core:n2" })]);
panes.push(["Gift · node out of reach", renderState("_app_gift", { giftNode: "core:n3" })]);

// The dock is frame chrome, not a view, so it has to be pulled out separately.
function dockFor(view) {
  const ui = new ScrollUI();
  ui.actor = me;
  ui.view = view;
  return html(ui._dock());
}

const dockHTML = dockFor("home");
const lockDockHTML = dockFor("lock");

/*
 * ------------------------------------------------------- GM Command Center
 *
 * The command centre is the other half of the module's surface area and it was
 * not in this preview, which is how a fault that hit every button in the client
 * could be called fixed on the strength of the device alone. It is a form
 * stack, so it suffers the host's `input`/`select`/`textarea`/`button` rules
 * harder than the device does, not less.
 *
 * Rendered one tab per pane, the same way the apps are: the section methods
 * take a container, so the panel shell is rebuilt here rather than going
 * through `render()`, which wants a real `document.body` to append to.
 */
/*
 * The tab list is imported rather than transcribed. It used to be copied here,
 * and the copy went stale the moment Maps and Queue were added in v1.11 — two
 * panes the preview silently stopped covering. The export exists so that cannot
 * happen again.
 */
const { GMPanel, GM_TABS } = await import("../scripts/ui-gm.mjs");

game.user.isGM = true;

function renderGM(section, tweak = {}) {
  const gm = new GMPanel();
  gm.actor = me;
  gm.section = section;
  Object.assign(gm, tweak);
  const body = makeEl("div");
  body.className = "zg-body";
  gm[`_gm_${section}`](body);
  return html(body);
}

/*
 * One pane per tab, plus the Gift editor — which is a second pane behind the
 * Gift tab and would otherwise never be drawn here at all.
 */
const GM_PANES = [
  ...GM_TABS.map(([key, label]) => ({ key, label, tweak: {} })),
  { key: "gift", label: "Gift · tree editor", tweak: { giftSub: "trees", giftPreview: 2 } },
  { key: "gift", label: "Gift · tree editor, node selected",
    tweak: { giftSub: "trees", giftPreview: 2, nodeSel: "n4" } },
];

const gmPanes = GM_PANES.map(({ key, label, tweak }) => {
  let markup;
  try {
    markup = renderGM(key, tweak);
  } catch (err) {
    markup = `<div class="zg-note">could not render: ${esc(err.message)}</div>`;
  }
  const tabs = GM_TABS.map(([k, l]) =>
    `<button class="zg-tab${k === key ? " active" : ""}" type="button">${esc(l)}</button>`).join("");
  return `
    <figure class="pv-fig">
      <figcaption class="pv-cap">Command Center · ${esc(label)}</figcaption>
      <div id="zs-gm" class="pv-gmhost">
        <div class="zg-panel">
          <div class="zg-header">
            <div class="zg-title">Command Center</div>
            <select class="zg-actsel"><option>Rin Adler</option></select>
            <div class="zg-close">×</div>
          </div>
          <div class="zg-tabs">${tabs}</div>
          ${markup}
        </div>
      </div>
    </figure>`;
}).join("");

// ------------------------------------------------------------- build the page
const css = fs.readFileSync(path.join(ROOT, "styles", "zenith-scroll.css"), "utf8");

/*
 * Foundry's own global element rules, loaded *before* the module stylesheet,
 * exactly as they are in the running game.
 *
 * Without this the preview is a kinder environment than the real one and lies
 * in the module's favour: Foundry styles the bare `button`, `input`, `textarea`
 * and `h1`-`h6` elements globally, so every one of those in the device is
 * fighting a rule the preview did not have. That is how a lock screen whose
 * unlock button is crushed from 34px of content into a 27px box could look
 * perfect here and wrong in the game. See tests/foundry-baseline.css.
 */
const baseline = fs.readFileSync(path.join(HERE, "foundry-baseline.css"), "utf8");

const grid = PANEL_HEIGHTS.map(h => `
  <section class="pv-col">
    <h2 class="pv-h">Panel height ${h}px</h2>
    ${panes.map(([label, markup]) => `
      <figure class="pv-fig">
        <figcaption class="pv-cap">${esc(label)}</figcaption>
        <div id="zs-ui" class="pv-host">
          <div class="zsu-frame" style="height:${h}px;max-height:${h}px">
            <div class="zsu-bloom"></div>
            <div class="zsu-edge"></div>
            <div class="zsu-screen">
              <div class="zsu-grain"></div>
              <div class="zsu-stage">${markup}</div>
              ${label === "Lock screen" ? lockDockHTML : dockHTML}
              <button class="zsu-close" type="button">×</button>
            </div>
          </div>
        </div>
      </figure>`).join("")}
  </section>`).join("");

const page = `<!doctype html>
<meta charset="utf-8">
<title>Zenith Scroll — view preview</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
<style>
${baseline}
</style>
<style>
${css}

/* --- preview chrome, not part of the module --- */
body { margin: 0; background: #16202a; color: #d6e4e6; }
.pv-wrap { display: flex; gap: 34px; padding: 26px; align-items: flex-start; overflow-x: auto; }
.pv-col { flex: 0 0 auto; }
.pv-h { position: sticky; top: 0; z-index: 99; margin: 0 0 14px; padding: 10px 12px;
        background: #0d1720; border: 1px solid #2a3a46; border-radius: 8px;
        font: 600 15px 'Outfit', sans-serif; color: #eaf6f7; }
.pv-fig { margin: 0 0 30px; }
.pv-cap { font: 500 12px 'JetBrains Mono', monospace; letter-spacing: 1px;
          text-transform: uppercase; color: #7d939a; margin-bottom: 8px; }
/* The host has to be static, not the fixed full-screen overlay it is in Foundry. */
#zs-ui.pv-host { position: static; inset: auto; display: block; width: 500px;
                 background: none; backdrop-filter: none; animation: none; }
.pv-host .zsu-frame { animation: none; margin: 0 auto; }
.pv-host .zsu-sweep { display: none; }
/* Same for the command centre: static, not the fixed overlay Foundry gets. */
#zs-gm.pv-gmhost { position: static; inset: auto; display: block; width: 760px;
                   background: none; backdrop-filter: none; animation: none; }
.pv-gmhost .zg-panel { animation: none; max-height: none; }
.pv-gmhost .zg-body { max-height: 620px; }
.pv-wrap-gm { flex-wrap: wrap; }
.pv-h-gm { margin: 8px 26px; }
</style>
<div class="pv-wrap">${grid}</div>
<h2 class="pv-h pv-h-gm">GM Command Center</h2>
<div class="pv-wrap pv-wrap-gm">${gmPanes}</div>
`;

fs.writeFileSync(OUT, page, "utf8");
console.log(`wrote ${OUT}`);
console.log(`${panes.length} views x ${PANEL_HEIGHTS.length} panel heights`);
