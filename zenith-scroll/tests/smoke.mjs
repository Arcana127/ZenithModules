/**
 * Zenith Academy Scroll — smoke test
 *
 *   node tests/smoke.mjs
 *
 * Stubs just enough of Foundry and the DOM to import the real modules and
 * exercise the logic that isn't purely visual. Nothing here talks to a browser,
 * so the unfurl animation, drag handling and dialog chrome still need a look in
 * the actual app.
 *
 * The fake DOM grew real parent links and a small selector engine in v1.7,
 * because the shell now queries and replaces nodes (`_syncChrome`, `_paint`)
 * rather than rebuilding everything from scratch — a stub that returns null for
 * every query would have made those paths untestable.
 */

let fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log("  PASS  " + name); }
  else { fails++; console.log("  FAIL  " + name + (extra ? "\n          " + extra : "")); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------- fake DOM

/** One compound selector: tag, .class, #id, [attr], [attr="value"]. */
function matches(node, sel) {
  const parts = sel.trim().match(/^([a-z]+)?((?:[.#][\w-]+|\[[^\]]+\])*)$/i);
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
      const key = m[1];
      const have = key.startsWith("data-")
        ? node.dataset[key.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())]
        : node.attrs[key];
      if (have === undefined) return false;
      if (m[2] !== undefined && String(have) !== m[2]) return false;
    }
  }
  return true;
}

function walk(node, fn) {
  for (const c of node.children) { fn(c); walk(c, fn); }
}

let activeElement = null;

function makeEl(tag) {
  const n = {
    tagName: tag, className: "", _text: "", innerHTML: "", children: [], parent: null,
    dataset: {}, attrs: {}, value: "", checked: false, scrollTop: 0, scrollHeight: 0,
    style: { setProperty() {}, },

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
    contains(other) {
      for (let p = other; p; p = p.parent) if (p === this) return true;
      return false;
    },
    closest(sel) {
      for (let p = this; p; p = p.parent) if (matches(p, sel)) return p;
      return null;
    },
    querySelector(sel) {
      let hit = null;
      walk(this, c => { if (!hit && matches(c, sel)) hit = c; });
      return hit;
    },
    querySelectorAll(sel) {
      const out = [];
      walk(this, c => { if (matches(c, sel)) out.push(c); });
      return out;
    },
    addEventListener() {}, removeEventListener() {},
    setAttribute(k, v) {
      this.attrs[k] = v;
      // A real element mirrors the class attribute onto className, and SVG is
      // built with setAttribute rather than el()'s `class` shortcut — without
      // this, nothing drawn as SVG could ever be selected in a test.
      if (k === "class") this.className = v;
      if (k.startsWith("data-")) {
        this.dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v;
      }
    },
    focus() { activeElement = this; },
    setSelectionRange() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 64, height: 64 }; },
    get firstElementChild() { return this.children[0] ?? null; },
    get lastElementChild() { return this.children[this.children.length - 1] ?? null; },
    offsetWidth: 0,
    get classList() {
      const self = this;
      const list = () => String(self.className).split(/\s+/).filter(Boolean);
      return {
        add(...cs) { self.className = [...new Set([...list(), ...cs])].join(" "); },
        remove(...cs) { self.className = list().filter(c => !cs.includes(c)).join(" "); },
        contains(c) { return list().includes(c); },
        toggle(c, force) {
          const on = force === undefined ? !list().includes(c) : !!force;
          if (on) this.add(c); else this.remove(c);
          return on;
        },
      };
    },
  };
  Object.defineProperty(n, "textContent", { get() { return this._text; }, set(v) { this._text = v; } });
  return n;
}

const body = makeEl("body");
globalThis.document = {
  createElement: makeEl,
  // The Gift editor draws its edges as real SVG, so the board is untestable
  // without this. Namespaced elements behave the same as any other node here;
  // only the tag matters to anything being asserted.
  createElementNS: (_ns, tag) => makeEl(tag),
  body,
  getElementById(id) {
    let hit = null;
    walk(body, c => { if (!hit && c.attrs.id === id) hit = c; });
    return hit;
  },
  querySelector: sel => body.querySelector(sel),
  querySelectorAll: sel => body.querySelectorAll(sel),
  addEventListener() {}, removeEventListener() {},
  get activeElement() { return activeElement; },
};
globalThis.window = {
  matchMedia: () => ({ matches: false }),
  innerWidth: 1600, innerHeight: 900,
  addEventListener() {}, removeEventListener() {},
};
globalThis.innerWidth = 1600;
globalThis.innerHeight = 900;
globalThis.CSS = { escape: s => String(s).replace(/["\\]/g, "\\$&") };

// ------------------------------------------------------------ fake Foundry
const hooks = [];
globalThis.Hooks = { once: (h, f) => hooks.push([h, f]), on: (h, f) => hooks.push([h, f]) };
globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
globalThis.foundry = { applications: { api: {} } };
globalThis.canvas = { tokens: { controlled: [] } };


// ------------------------------------------------------- fake journal layer
//
// The Notes app is a view onto a JournalEntry, so testing it means having one.
// `pages` is deliberately not a Map: Foundry's EmbeddedCollection spreads to
// documents, and `[...Map]` spreads to [key, value] pairs, so a Map would make
// `[...book.pages]` quietly wrong in exactly the way the real code depends on.

let pageSeq = 0, entrySeq = 0;
const journalRenders = [];

class PageBag {
  constructor() { this._m = new Map(); }
  get(id) { return this._m.get(id) ?? null; }
  set(id, p) { this._m.set(id, p); return p; }
  delete(id) { return this._m.delete(id); }
  get size() { return this._m.size; }
  [Symbol.iterator]() { return this._m.values(); }
}

function makePage(parent, d) {
  return {
    id: d.id ?? "pg" + (++pageSeq),
    name: d.name ?? "Untitled",
    type: d.type ?? "text",
    text: { content: d.text?.content ?? "", format: d.text?.format ?? 1 },
    parent,
    _stats: { modifiedTime: Date.now(), lastModifiedBy: game.user.id },
    _locked: false,
    canUserModify() { return !this._locked; },
    async update(patch) {
      if ("name" in patch) this.name = patch.name;
      if ("text.content" in patch) this.text.content = patch["text.content"];
      if ("text.format" in patch) this.text.format = patch["text.format"];
      this._stats.modifiedTime = Date.now() + (++pageSeq);
      this._stats.lastModifiedBy = game.user.id;
      return this;
    },
  };
}

function makeEntry(name, flags = {}, ownership = { default: 0 }) {
  return {
    id: "je" + (++entrySeq), name, ownership,
    pages: new PageBag(),
    _flags: flags,
    getFlag(m, k) { return this._flags?.[m]?.[k]; },
    canUserModify() { return true; },
    async update(patch) { Object.assign(this, patch); return this; },
    async createEmbeddedDocuments(_type, defs) {
      return defs.map(d => {
        const p = makePage(this, d);
        this.pages.set(p.id, p);
        return p;
      });
    },
    async deleteEmbeddedDocuments(_type, ids) {
      for (const id of ids) this.pages.delete(id);
      return ids;
    },
    sheet: { render(_force, opts) { journalRenders.push({ name, opts }); } },
  };
}

const journal = [];
globalThis.JournalEntry = {
  async create(data) {
    const e = makeEntry(data.name, data.flags ?? {}, data.ownership ?? { default: 0 });
    journal.push(e);
    return e;
  },
};
globalThis.Folder = {
  async create(d) { const f = { id: "fold" + (++entrySeq), ...d }; game.folders.push(f); return f; },
};
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 } };

/*
 * A file picker whose folder contents the test sets. `browse` throwing is how
 * Foundry reports a directory that does not exist, which the sweep has to treat
 * as "nothing to do" rather than as a fault, so null means throw.
 */
let browseResult = null;
globalThis.FilePicker = {
  async browse(_source, dir) {
    if (!browseResult) throw new Error("ENOENT: no such directory");
    return { target: dir, files: browseResult.files ?? [], dirs: [] };
  },
  async createDirectory() {},
  async upload(_source, dir, file) { return { path: `${dir}/${file.name}` }; },
};

const updates = [];                     // every actor.update(), for assertions

/**
 * An actor with a portrait AND a prototype token, because v1.8 draws the small
 * circular avatars from the token and the large contact portrait from the
 * actor. A fixture with only one of them cannot tell those two paths apart.
 */
function makeActor(name, flags = {}) {
  return {
    id: "actor-" + name.toLowerCase().replace(/\W/g, ""), name,
    img: "portrait/" + name + ".webp",
    prototypeToken: { texture: { src: "token/" + name + ".webp" } },
    isOwner: true, items: [], _flags: flags,
    getFlag(_m, k) { return this._flags[k]; },
    async update(data, opts) {
      updates.push({ actor: this.name, data, opts });
      Object.assign(this._flags, data.flags["zenith-scroll"]);
    },
    async unsetFlag(_m, k) { delete this._flags[k]; },
    // Items carry ids from v1.12, because a Gift refund takes back exactly what
    // an unlock created — by id, never by name.
    async createEmbeddedDocuments(_type, defs) {
      const made = [];
      for (const d of defs) {
        const it = makeItem(d.name, d.system?.quantity ?? 0);
        this.items.push(it);
        made.push(it);
      }
      return made;
    },
    async deleteEmbeddedDocuments(_type, ids) {
      const gone = this.items.filter(i => ids.includes(i.id));
      this.items = this.items.filter(i => !ids.includes(i.id));
      return gone;
    },
    testUserPermission() { return true; },
  };
}

let itemSeq = 0;

/** An inventory item whose quantity can actually be written, as grants do. */
function makeItem(name, quantity = 0) {
  return {
    id: "item-" + (++itemSeq), name, system: { quantity },
    async update(data) {
      const q = data["system.quantity"] ?? data.system?.quantity;
      if (q !== undefined) this.system.quantity = q;
    },
  };
}

/** game.users is a Foundry Collection, not a bare array - it needs .get(). */
function userList(arr) {
  return Object.assign(arr, { get: id => arr.find(u => u.id === id) });
}

let settings = {
  enablePlayerMessaging: true,
  galleryFolder: "scroll-gallery",
  marksItemName: "marks",
  useTokenImages: true,
  currencies: [
    { key: "marks",  itemName: "marks",  label: "Marks",  icon: "fa-coins", tint: "#e0c050", primary: true },
    { key: "astras", itemName: "astras", label: "Astras", icon: "fa-star",  tint: "#a6f2fb", primary: false },
  ],
  resetHash: {},
  worldAnnouncements: [],
  worldEvents: [],
  worldGiftTrees: [],
  worldContentSeeded: false,
  schemaVersion: 0,
};

/**
 * The compendium, as far as Gift grants are concerned.
 *
 * A UUID that is not in here resolves to null, which is the case the unlock
 * path has to survive rather than refuse: a tree can outlive the module whose
 * pack it pointed at.
 */
const compendium = {
  "Compendium.pf2e.feats-srd.Item.EMBERFIST": { name: "Ember Fist", type: "feat" },
  "Compendium.pf2e.feats-srd.Item.QUICKSTEP": { name: "Quick Step", type: "feat" },
};
globalThis.fromUuid = async uuid => {
  const raw = compendium[uuid];
  if (!raw) return null;
  return { ...raw, toObject: () => ({ ...raw, _id: "packid" }) };
};
let settingsThrow = false;
const actors = [];
globalThis.game = {
  actors: Object.assign(actors, {
    get: id => actors.find(a => a.id === id),
    getName: n => actors.find(a => a.name === n),
  }),
  users: userList([]),
  journal,
  folders: [],
  user: {
    isGM: false, id: "u1", character: null,
    _flags: {},
    getFlag(_m, k) { return this._flags[k] ?? null; },
    async setFlag(_m, k, v) { this._flags[k] = v; },
    // Foundry's upload permission is off for players by default, which is the
    // case worth defaulting to here: it routes captures through the GM relay.
    can: () => false,
  },
  keybindings: { _reg: [], register(m, k, d) { this._reg.push({ m, k, d }); } },
  settings: {
    _menus: [],
    registerMenu(m, k, d) { this._menus.push({ m, k, d }); },
    register() {},
    get(_m, k) { if (settingsThrow) throw new Error("not registered"); return settings[k]; },
    async set(_m, k, v) { settings[k] = v; },
  },
  time: { worldTime: 0 }, modules: { get: () => null }, socket: { on() {}, emit() {} },
  world: { id: "zenith-test" },
};

// ------------------------------------------------- import the real modules
// The entry is imported for its side effect of registering hooks.
await import("../scripts/zenith-scroll.mjs");
const {
  esc, relInfo, app, APPS, accentInfo, daysLabel, reducedMotion, safeImageSrc,
  currencyList, primaryCurrency, currencyInfo, makeSalt, hashPassphrase, verifyPassphrase,
} = await import("../scripts/core.mjs");
const {
  loadSection, saveSection, totalUnread, announcementsFor, unreadNotices,
  getNotifications, unseenNotifications, pushNotification, backfillTimestamps, getMarks,
  portraitOf, resolveKeyArt, resolvePortrait, getCurrency, getBalances, grantCurrency,
  getLedger, dismissNotification, exportScrollData, scrollDataSummary, clearScrollData,
  refreshPortraits, getGallery, addGalleryImage, removeGalleryImage, pushImageToAll,
  referencedImages, getGiftTree, setGiftTree, assignGiftTrees, grantGiftPoints,
} = await import("../scripts/data.mjs");
const {
  getAnnouncements, setAnnouncements, getEvents, setEvents, nextEvent, seedWorldContent,
  getMaps, setMaps, visibleMaps, getQueued, setQueued,
  getGiftTrees, setGiftTrees, giftTreeById, saveGiftTree, deleteGiftTree, cleanGiftNode,
  schemaVersion,
} = await import("../scripts/world.mjs");
const {
  resolveGiftTree, unlockGiftNode, refundGiftNode, resetGiftTree, giftNodeState,
  dependentsOf, validateGiftGraph, validateGiftTree, deadGrants, migrateGiftTrees,
  nsId, qualify, LOCAL_TREE,
} = await import("../scripts/gift.mjs");
const { msgEnabled, gmOnline } = await import("../scripts/socket.mjs");
const {
  BOOKS, notebookFor, partyNotebook, bookFor, ensureNotebook, ensurePartyNotebook,
  provisionNotebooks, canWrite, createNote, saveNote, deleteNote, listNotes,
  noteCount, popOut, htmlToText, textToHtml, isPlainish,
  notebookMarkdown, allNotesMarkdown, htmlToMarkdown,
} = await import("../scripts/notes.mjs");
const {
  canCapture, captureDir, captureName, canUploadDirectly, ownerOfCapture,
  beginDeveloping, developing, finishDeveloping, failDeveloping, deletionScript,
  findOrphanCaptures,
} = await import("../scripts/capture.mjs");
const { ScrollUI, ScrollIcon } = await import("../scripts/ui-scroll.mjs");

/** Build a ScrollUI parked on an actor, without opening it. */
function uiFor(actor, patch = {}) {
  const v = new ScrollUI();
  v.actor = actor;
  Object.assign(v, patch);
  return v;
}

/** Render one view into a detached container and hand back its markup. */
function draw(v, method) {
  const c = makeEl("div");
  v[method](c);
  return c;
}

/** Every innerHTML and textContent in a subtree, concatenated. */
function textOf(node) {
  let out = node.innerHTML ?? "";
  walk(node, c => { out += (c.innerHTML ?? "") + (c._text ?? ""); });
  return out;
}

// =========================================================================
console.log("\n[core] HTML escaping");
ok("escapes all five entities", esc(`<img src=x onerror="a">&'`) === "&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;");
ok("null/undefined -> empty string", esc(null) === "" && esc(undefined) === "");
ok("passes plain text through", esc("Ilya Vance") === "Ilya Vance");

console.log("\n[core] relationship scale");
ok("maps a rank to its label", relInfo(4).label === "Trusted");
ok("unknown rank falls back to Neutral", relInfo(99).label === "Neutral");

console.log("\n[core] app registry");
ok("every app has an id, label and icon",
  APPS.length >= 8 && APPS.every(a => a.id && a.label && a.icon));
ok("app ids are unique", new Set(APPS.map(a => a.id)).size === APPS.length);
ok("the dock is a subset of the grid, and not all of it",
  APPS.some(a => a.dock) && APPS.some(a => !a.dock));

console.log("\n[core] countdown labels");
ok("0 days reads TODAY", daysLabel(0) === "TODAY");
ok("1 day reads TOMORROW", daysLabel(1) === "TOMORROW");
ok("a past event reads PASSED", daysLabel(-2) === "PASSED");
ok("anything else counts days", daysLabel(4) === "4 days");

console.log("\n[core] accents");
ok("a known accent resolves", accentInfo("ember").label === "Ember");
ok("an unknown accent falls back to Aether", accentInfo("nope").id === "aether");

console.log("\n[core] reduced motion");
ok("the per-student toggle wins on its own", reducedMotion({ reduceMotion: true }) === true);
ok("no toggle and no OS preference means motion is on", reducedMotion({}) === false);

// =========================================================================
console.log("\n[data] saveSection: nested notation + silent flag");
const a1 = makeActor("Test One");
updates.length = 0;
await saveSection(a1, "profile", { status: "hi" });
await saveSection(a1, "social", { conversations: [] }, { silent: true });
ok("uses nested flags object, never a dot path",
  eq(Object.keys(updates[0].data), ["flags"]) &&
  eq(Object.keys(updates[0].data.flags), ["zenith-scroll"]) &&
  eq(Object.keys(updates[0].data.flags["zenith-scroll"]), ["profile"]),
  JSON.stringify(updates[0].data));
ok("default save is not silent", updates[0].opts.zenithSilent === false);
ok("silent save tags the update", updates[1].opts.zenithSilent === true);

console.log("\n[data] loadSection: defaults + merge + isolation");
const a2 = makeActor("Test Two", { profile: { status: "busy" } });
const p = loadSection(a2, "profile");
ok("missing keys fall back to defaults", p.year === 1 && p.cohort === "");
ok("stored keys win", p.status === "busy");
p.status = "MUTATED";
ok("returned object is a deep copy", a2._flags.profile.status === "busy");
ok("absent section returns full defaults", loadSection(a2, "media").gallery.length === 0);
ok("prefs is its own section with its own defaults",
  loadSection(a2, "prefs").accent === "aether" && loadSection(a2, "prefs").reduceMotion === false);

console.log("\n[data] totalUnread");
const a3 = makeActor("Test Three", { social: { conversations: [
  { id: "c1", messages: [{ read: false, sent: false }, { read: true, sent: false }, { read: false, sent: true }] },
  { id: "c2" },                                       // malformed: no messages array
  { id: "c3", messages: [{ read: false, sent: false }] },
] } });
ok("counts only unread inbound, survives missing arrays", totalUnread(a3) === 2, "got " + totalUnread(a3));

console.log("\n[data] marks item name is configurable");
const a4 = makeActor("Test Four");
a4.items = [{ name: "Marks", system: { quantity: 12 } }, { name: "Chits", system: { quantity: 99 } }];
ok("reads the default item name, case-insensitively", getMarks(a4) === 12);
settings.marksItemName = "chits";
ok("follows the setting when the currency is renamed", getMarks(a4) === 99);
settings.marksItemName = "marks";

console.log("\n[data] portraits: token art for avatars, key art for the detail panel");
{
  const a = makeActor("Token Haver");
  actors.push(a);
  ok("prefers the prototype token", portraitOf(a) === "token/Token Haver.webp");
  ok("resolvePortrait, by name, does the same", resolvePortrait("Token Haver") === "token/Token Haver.webp");
  ok("the contact detail panel keeps the actor's key art",
    resolveKeyArt("Token Haver") === "portrait/Token Haver.webp");

  settings.useTokenImages = false;
  ok("the setting turns the whole behaviour off", portraitOf(a) === "portrait/Token Haver.webp");
  settings.useTokenImages = true;

  const noToken = makeActor("No Token");
  noToken.prototypeToken = null;
  ok("an actor with no token falls back to the portrait", portraitOf(noToken) === "portrait/No Token.webp");
  ok("no actor resolves to null", portraitOf(null) === null);

  actors.splice(actors.indexOf(a), 1);
}

console.log("\n[core] currency configuration");
{
  ok("both currencies are configured", currencyList().length === 2);
  ok("Marks is primary", primaryCurrency().key === "marks");
  ok("an unknown key resolves to null", currencyInfo("nope") === null);

  const saved = settings.currencies;
  settings.currencies = "not an array";
  ok("a malformed setting falls back to the defaults rather than throwing",
    currencyList().length === 2 && currencyList()[0].key === "marks");

  settings.currencies = [{ key: "astras", itemName: "astras", label: "Astras" }];
  ok("a list with no primary gets one anyway", primaryCurrency().key === "astras");
  settings.currencies = saved;
}

console.log("\n[data] balances read from item quantity");
{
  const a = makeActor("Rich Student");
  a.items = [makeItem("Marks", 40), makeItem("astras", 7)];
  ok("reads a balance by key, case-insensitively", getCurrency(a, "marks") === 40);
  ok("reads the second currency too", getCurrency(a, "astras") === 7);
  ok("an unconfigured key reads 0", getCurrency(a, "gold") === 0);

  const bal = getBalances(a);
  ok("getBalances returns one entry per configured currency", bal.length === 2);
  ok("each entry carries its amount and its tint",
    bal[0].amount === 40 && !!bal[0].tint && !!bal[0].icon);

  const broke = makeActor("Broke Student");
  ok("a student with no currency item reads 0 rather than throwing",
    getCurrency(broke, "marks") === 0 && getBalances(broke).every(b => b.amount === 0));
}

console.log("\n[data] grants move the balance and write the ledger");
{
  const a = makeActor("Ledger Student");
  a.items = [makeItem("astras", 10)];

  const after = await grantCurrency(a, "astras", 50, "Tournament prize");
  ok("the item quantity moved", after === 60 && a.items[0].system.quantity === 60);

  const led = getLedger(a);
  ok("a ledger line was written", led.length === 1);
  ok("the line records the delta, the balance and the reason",
    led[0].delta === 50 && led[0].balance === 60 && led[0].reason === "Tournament prize");

  await grantCurrency(a, "astras", -15, "Replacement wand");
  ok("a negative amount is a charge", a.items[0].system.quantity === 45);
  ok("the newest line is first", getLedger(a)[0].delta === -15);

  await grantCurrency(a, "astras", -999, "Cannot go below zero");
  ok("a balance never goes negative", a.items[0].system.quantity === 0);

  ok("a zero grant writes nothing", await grantCurrency(a, "astras", 0, "nope") === null);
  ok("an unconfigured currency writes nothing", await grantCurrency(a, "gold", 5, "nope") === null);

  const fresh = makeActor("Unpaid Student");
  await grantCurrency(fresh, "marks", 25, "First stipend");
  ok("a student with no item yet gets one created",
    fresh.items.length === 1 && fresh.items[0].system.quantity === 25);
}

console.log("\n[data] per-notification dismiss");
{
  const a = makeActor("Noisy Student");
  await pushNotification(a, { title: "One", app: "messages" });
  await pushNotification(a, { title: "Two", app: "notices" });
  await pushNotification(a, { title: "Three" });
  ok("three alerts logged", getNotifications(a).length === 3);

  const victim = getNotifications(a).find(n => n.title === "Two");
  ok("dismissing one reports that it removed something",
    await dismissNotification(a, victim.id) === true);
  ok("only that one is gone",
    getNotifications(a).length === 2 && !getNotifications(a).some(n => n.title === "Two"));
  ok("dismissing it again is a no-op", await dismissNotification(a, victim.id) === false);
  ok("dismissing nothing is a no-op", await dismissNotification(a, null) === false);
  ok("the dismiss is written silently, so the list is not torn down mid-click",
    updates[updates.length - 1].opts.zenithSilent === true);
}

console.log("\n[core] passphrase hashing");
{
  const salt = makeSalt();
  ok("a salt is generated", typeof salt === "string" && salt.length >= 16);
  ok("two salts differ", makeSalt() !== makeSalt());

  const hash = await hashPassphrase("open sesame", salt);
  ok("SHA-256 is used where crypto.subtle exists", hash.startsWith("sha256:"));
  ok("the same input hashes the same", await hashPassphrase("open sesame", salt) === hash);
  ok("a different salt gives a different hash",
    await hashPassphrase("open sesame", makeSalt()) !== hash);

  const record = { salt, hash };
  ok("the right passphrase verifies", await verifyPassphrase("open sesame", record) === true);
  ok("the wrong one does not", await verifyPassphrase("open sesamr", record) === false);
  ok("an empty record never verifies", await verifyPassphrase("anything", {}) === false);

  // The insecure-context path: plain HTTP has no crypto.subtle at all.
  const realSubtle = globalThis.crypto.subtle;
  Object.defineProperty(globalThis.crypto, "subtle", { value: undefined, configurable: true });
  const weak = await hashPassphrase("open sesame", salt);
  ok("it falls back to the pure-JS hash without crypto.subtle", weak.startsWith("weak:"));
  ok("the fallback still verifies its own hashes",
    await verifyPassphrase("open sesame", { salt, hash: weak }) === true);
  ok("and still rejects a wrong one",
    await verifyPassphrase("nope", { salt, hash: weak }) === false);
  Object.defineProperty(globalThis.crypto, "subtle", { value: realSubtle, configurable: true });

  ok("a hash written over HTTP still verifies once the world moves to HTTPS",
    await verifyPassphrase("open sesame", { salt, hash: weak }) === true);
}

// =========================================================================
console.log("\n[world] C1: announcements and events are world-scope");
settings.worldAnnouncements = [];
settings.worldEvents = [];
game.user.isGM = true;

await setAnnouncements([{ text: "Assembly at first bell", time: "8:00 AM" }, { text: "" }]);
ok("blank notices are dropped on save", getAnnouncements().length === 1);
ok("a notice gets a stable id", !!getAnnouncements()[0].id);

const keptId = getAnnouncements()[0].id;
await setAnnouncements(getAnnouncements());
ok("re-saving reuses the same id", getAnnouncements()[0].id === keptId);

await setEvents([
  { name: "Second Examination", days: 4 },
  { name: "Founders Day", days: 1 },
  { name: "Last Term's Duel", days: -3 },
]);
ok("nextEvent picks the soonest upcoming", nextEvent()?.name === "Founders Day");
ok("nextEvent skips events already past",
  getEvents().length === 3 && nextEvent()?.days === 1);

await setEvents([{ name: "Old Thing", days: -1 }]);
ok("nothing upcoming returns null", nextEvent() === null);

console.log("\n[world] a player cannot write world content");
game.user.isGM = false;
await setAnnouncements([{ text: "I am not the GM" }]);
ok("a player's write is refused", getAnnouncements().length === 1 &&
  getAnnouncements()[0].text === "Assembly at first bell");
game.user.isGM = true;

console.log("\n[world] C1 seeding lifts per-actor content once");
settings.worldAnnouncements = [];
settings.worldEvents = [];
settings.worldContentSeeded = false;

const seedThin = makeActor("Thin Student", {
  system: { announcements: [{ id: "old1", text: "Only one" }] },
  academic: { nextEvent: "Second Examination", nextEventDays: 2 },
});
const seedRich = makeActor("Rich Student", {
  system: { announcements: [{ id: "old1", text: "Only one" }, { id: "old2", text: "And another" }] },
  academic: { nextEvent: "Second Examination", nextEventDays: 2 },
});
game.users = userList([
  { isGM: false, active: true, id: "s1", character: seedThin },
  { isGM: false, active: true, id: "s2", character: seedRich },
]);

await seedWorldContent();
ok("harvests the richest notice list, not the first",
  getAnnouncements().length === 2, "got " + getAnnouncements().length);
ok("the event is lifted too", nextEvent()?.name === "Second Examination");
ok("duplicate events across students collapse to one", getEvents().length === 1);
ok("the migration marks itself done", settings.worldContentSeeded === true);
ok("a schema version is recorded", settings.schemaVersion >= 2);

const beforeRerun = getAnnouncements().length;
await setAnnouncements([{ text: "GM edited this afterwards" }]);
await seedWorldContent();
ok("seeding does not run a second time and clobber edits",
  getAnnouncements().length === 1 && getAnnouncements()[0].text === "GM edited this afterwards",
  "before " + beforeRerun);

// =========================================================================
console.log("\n[data] notices are read from world scope, dismissals stay personal");
settings.worldAnnouncements = [];
await setAnnouncements([{ id: "ann_a", text: "Assembly" }, { id: "ann_b", text: "Exam" }]);

const student = makeActor("Rin Adler", { system: { dismissedAnnouncements: ["ann_b"] } });
ok("a dismissed notice is hidden", announcementsFor(student).map(a => a.text).join() === "Assembly");
ok("the undismissed count drives the badge", unreadNotices(student) === 1);

await setAnnouncements([{ id: "ann_b", text: "Exam" }, { id: "ann_a", text: "Assembly" }]);
ok("dismissals still correct after the GM reorders the board",
  announcementsFor(student).map(a => a.text).join() === "Assembly");

console.log("\n[data] legacy per-actor notices survive until the GM logs in");
settings.worldAnnouncements = [];
const legacy = makeActor("Legacy Student", {
  system: { announcements: [{ text: "Old A" }, { text: "Old B" }], dismissedAnnouncements: [1] },
});
const legacyOut = announcementsFor(legacy).map(a => a.text);
ok("falls back to actor flags when world content is empty", legacyOut.includes("Old A"));
ok("pre-v1.6 numeric dismissals are still honoured", !legacyOut.includes("Old B"));

await setAnnouncements([{ id: "w1", text: "World notice" }]);
ok("world content takes over as soon as it exists",
  announcementsFor(legacy).map(a => a.text).join() === "World notice");

// =========================================================================
console.log("\n[data] notification log");
const notified = makeActor("Notified Student");
await pushNotification(notified, { icon: "fa-bell", title: "First", body: "one", app: "messages" });
await pushNotification(notified, { title: "Second", body: "two" });
ok("entries are stored newest first", getNotifications(notified)[0].title === "Second");
ok("everything unseen counts", unseenNotifications(notified) === 2);
ok("each entry gets an id and a timestamp",
  getNotifications(notified).every(n => n.id && n.ts));

for (let i = 0; i < 45; i++) await pushNotification(notified, { title: "Spam " + i });
ok("the log is capped so the flag cannot grow forever",
  getNotifications(notified).length === 40, "got " + getNotifications(notified).length);

const notMine = makeActor("Someone Else");
notMine.isOwner = false;
await pushNotification(notMine, { title: "Should not land" });
ok("nothing is written to an actor we do not own", getNotifications(notMine).length === 0);

console.log("\n[data] C4: backfilling message sort timestamps");
const stale = makeActor("Stale Threads", { social: { conversations: [{
  id: "c-stale",
  participants: ["Stale Threads", "Prof. Hale"],
  messages: [
    { from: "Prof. Hale", text: "first", time: "8 AM" },
    { from: "Prof. Hale", text: "second", time: "9 AM" },
    { from: "Prof. Hale", text: "third", time: "10 AM", ts: 5_000_000 },
  ],
}] } });
ok("a thread with gaps is reported as touched", await backfillTimestamps(stale) === true);
const stamped = loadSection(stale, "social").conversations[0].messages;
ok("every message now has a timestamp", stamped.every(m => Number(m.ts) > 0));
ok("inferred stamps keep the authored order",
  stamped[0].ts < stamped[1].ts && stamped[1].ts < stamped[2].ts);
ok("a real timestamp is left exactly as it was", stamped[2].ts === 5_000_000);
ok("a second pass is a no-op", await backfillTimestamps(stale) === false);

// =========================================================================
console.log("\n[socket] availability gates");
ok("reads the world setting", msgEnabled() === true);
settings.enablePlayerMessaging = false;
ok("honours 'off'", msgEnabled() === false);
settings.enablePlayerMessaging = true;
settingsThrow = true;
ok("falls back to true if unregistered", msgEnabled() === true);
settingsThrow = false;

game.users = userList([{ isGM: true, active: false, character: null }, { isGM: false, active: true, character: null }]);
ok("no active GM is detected", gmOnline() === false);
game.users = userList([{ isGM: true, active: true, character: null }]);
ok("active GM is detected", gmOnline() === true);

// =========================================================================
console.log("\n[ui] conversation ordering + empty threads");
const me = makeActor("Rin Adler");
actors.length = 0;
actors.push(me, makeActor("Ilya Vance"), makeActor("Prof. Hale"));

me._flags.social = { relationships: [], conversations: [
  // created FIRST, but most recently active -> must sort to the top
  { id: "c-old", participants: ["Rin Adler", "Prof. Hale"], isGroup: false,
    messages: [{ from: "Prof. Hale", text: "See me after class.", time: "9:00 AM", ts: 5000, read: true, sent: false }] },
  { id: "c-mid", participants: ["Rin Adler", "Ilya Vance"], isGroup: false,
    messages: [{ from: "Ilya Vance", text: "later", time: "8:00 AM", ts: 1000, read: false, sent: false }] },
  // created LAST, never used -> pre-v1.6 this row vanished entirely
  { id: "c-new", participants: ["Rin Adler", "Prof. Hale"], isGroup: false, messages: [] },
] };

const msgView = uiFor(me);
const msgCt = draw(msgView, "_app_messages");
const rows = msgCt.querySelectorAll(".zsm-thread");
const rowName = r => r.querySelector(".zsm-tinfo")?.innerHTML.match(/zsm-tname">([^<]*)/)?.[1] ?? "?";
const order = rows.map(rowName);
ok("sorts by last message ts, not creation order", order[0] === "Prof. Hale" && order[1] === "Ilya Vance",
  "got " + JSON.stringify(order));
ok("empty conversations are still listed", rows.length === 3, "rendered " + rows.length + " rows");
ok("empty thread shows a placeholder preview", textOf(msgCt).includes("No messages yet"));

console.log("\n[ui] escaping through a message preview");
me._flags.social.conversations = [{
  id: "c-xss", participants: ["Rin Adler", "Ilya Vance"], isGroup: false,
  messages: [{ from: "Ilya Vance", text: "<img src=x onerror=alert(1)>", time: "1:00 PM", ts: 9, read: true, sent: false }],
}];
const xssHtml = textOf(draw(uiFor(me), "_app_messages"));
ok("message text is escaped in the thread list", !xssHtml.includes("<img src=x") && xssHtml.includes("&lt;img"));

console.log("\n[ui] New Conversation button honours the setting");
const newBtnCount = () => draw(uiFor(me), "_app_messages").querySelectorAll(".zsu-apbtn").length;
settings.enablePlayerMessaging = true;
ok("shown when messaging is on", newBtnCount() === 1);
settings.enablePlayerMessaging = false;
ok("hidden when messaging is off", newBtnCount() === 0);
settings.enablePlayerMessaging = true;

console.log("\n[ui] mute is wired up, not just stored");
me._flags.social.conversations[0].muted = true;
const mutedHtml = textOf(draw(uiFor(me), "_app_messages"));
ok("a muted thread is marked in the list", mutedHtml.includes("zsm-tmute"));
me._flags.social.conversations[0].muted = false;

console.log("\n[ui] thread view: day separators and grouped senders");
const dayMs = 86_400_000;
me._flags.social.conversations = [{
  id: "c-days", participants: ["Rin Adler", "Ilya Vance", "Prof. Hale"], isGroup: true, title: "Study Group",
  messages: [
    { from: "Ilya Vance", text: "a", time: "8 AM", ts: Date.now() - dayMs * 2, read: true, sent: false },
    { from: "Ilya Vance", text: "b", time: "8 AM", ts: Date.now() - dayMs * 2, read: true, sent: false },
    { from: "Prof. Hale", text: "c", time: "9 AM", ts: Date.now(), read: true, sent: false },
  ],
}];
const threadCt = draw(uiFor(me, { convId: "c-days" }), "_app_messages");
ok("days are separated", threadCt.querySelectorAll(".zsm-daysep").length === 2);
ok("the most recent separator reads Today",
  threadCt.querySelectorAll(".zsm-daysep").pop()._text === "Today");
const fromLabels = threadCt.querySelectorAll(".zsm-msg").map(m => m.innerHTML.includes("zsm-mfrom"));
ok("a run from one sender is labelled once", eq(fromLabels, [true, false, true]),
  JSON.stringify(fromLabels));

console.log("\n[ui] contact detail survives a re-render");
me._flags.social.relationships = [{ name: "Prof. Hale", title: "Instructor", rank: 2, category: "Faculty", notes: "wary of me" }];
const relView = uiFor(me, { relContact: "Prof. Hale" });
ok("re-render with relContact set lands on the detail panel, not the grid",
  !!draw(relView, "_app_contacts").querySelector(".zsr-vn-detail"));

relView.relContact = "Someone Who Left";
const gridCt = draw(relView, "_app_contacts");
ok("a contact that no longer exists falls back to the grid",
  relView.relContact === null && !gridCt.querySelector(".zsr-vn-detail"));

// =========================================================================
console.log("\n[ui] notices app");
settings.worldAnnouncements = [];
await setAnnouncements([
  { id: "n1", text: "Assembly", time: "8 AM" },
  { id: "n2", text: "<script>bad()</script>", pinned: true },
]);
me._flags.system = { dismissedAnnouncements: [], notifications: [] };
const noticeCt = draw(uiFor(me), "_app_notices");
ok("both notices render", noticeCt.querySelectorAll(".zsb-notice").length === 2);
ok("a pinned notice sorts to the top",
  noticeCt.querySelectorAll(".zsb-notice")[0].className.includes("pinned"));
const noticeHtml = textOf(noticeCt);
ok("notice text is escaped", !noticeHtml.includes("<script>") && noticeHtml.includes("&lt;script&gt;"));

me._flags.system.dismissedAnnouncements = ["n1"];
ok("dismissed notices do not render",
  draw(uiFor(me), "_app_notices").querySelectorAll(".zsb-notice").length === 1);
me._flags.system.dismissedAnnouncements = [];

console.log("\n[ui] student ID escaping");
me._flags.profile = { studentId: "ZA-TEST", year: 1, status: "<img src=x onerror=alert(1)>" };
const idHtml = textOf(draw(uiFor(me), "_app_profile"));
ok("status is escaped", !idHtml.includes("<img src=x") && idHtml.includes("&lt;img"));

// =========================================================================
console.log("\n[hooks] registration");
const names = hooks.map(h => h[0]);
ok("registers the v13+ context hook", names.includes("getActorContextOptions"));
ok("no longer registers the dead v12 hook", !names.includes("getActorDirectoryEntryContext"));
ok("updateActor hook present", names.includes("updateActor"));
ok("updateActor takes (doc, changed, options, userId)",
  hooks.find(h => h[0] === "updateActor")[1].length === 4);
ok("init and ready are registered", names.includes("init") && names.includes("ready"));
ok("world content changes reach open devices", names.includes("updateSetting"));

console.log("\n[wiring] singleton registry");
ok("app registry exists with the three slots",
  app && "icon" in app && "ui" in app && "gm" in app);

// =========================================================================
// Every render path, executed. A split turns a missing import into a runtime
// ReferenceError that `node --check` cannot see, so the point here is simply
// that each path runs to completion.
console.log("\n[coverage] every view and app renders");
const { GMPanel, GM_TABS } = await import("../scripts/ui-gm.mjs");
const { ZenithAPI } = await import("../scripts/api.mjs");
const { initSocket } = await import("../scripts/socket.mjs");

me._flags.academic = {
  schedule: [{ period: "First Bell", course: "Rites", instructor: "Hale", location: "Hall" }],
  gift: "Emberwake", giftDescription: "<em>burns</em>", giftLevel: 3,
  giftMilestones: [{ name: "First Spark", achieved: true }, { name: "Second", achieved: false }],
  nextEvent: "Second Examination", nextEventDays: 2, notes: "<b>ok</b>",
};
me._flags.media = { gallery: [{ src: "a.webp", caption: "Field trip" }] };
me._flags.prefs = { accent: "ember", deviceName: "Rin's Scroll", reduceMotion: false };

for (const viewName of ["lock", "home"]) {
  let threw = null;
  try { draw(uiFor(me), "_view_" + viewName); } catch (e) { threw = e; }
  ok("ScrollUI renders the " + viewName + " view", !threw, threw && (threw.constructor.name + ": " + threw.message));
}

for (const a of APPS) {
  let threw = null;
  try { draw(uiFor(me), "_app_" + a.id); } catch (e) { threw = e; }
  ok("ScrollUI renders the " + a.id + " app", !threw, threw && (threw.constructor.name + ": " + threw.message));
}

ok("every app in the registry has a renderer",
  APPS.every(a => typeof ScrollUI.prototype["_app_" + a.id] === "function"));

console.log("\n[coverage] Alerts replaced the notification-centre overlay");
{
  ok("the overlay renderer is gone",
    typeof ScrollUI.prototype._notifCentre === "undefined");
  ok("Alerts is a real app with a renderer",
    APPS.some(a => a.id === "alerts") && typeof ScrollUI.prototype._app_alerts === "function");

  const c = draw(uiFor(me), "_app_alerts");
  ok("each alert row carries its own dismiss control",
    c.querySelectorAll(".zsy-x").length === getNotifications(me).length,
    `${c.querySelectorAll(".zsy-x").length} of ${getNotifications(me).length}`);
  ok("a dismiss button is never nested inside the row's own button",
    c.querySelectorAll(".zsy-x").every(x => x.closest("button") === x));
}

console.log("\n[ui] the status bar's four jobs found new homes");
{
  // 1. the bell -> the home header, with the badge that used to sit on the bar
  const home = draw(uiFor(me), "_view_home");
  const bell = home.querySelector(".zsn-bell");
  ok("the home header carries a bell", !!bell);
  ok("the bell is marked when something is unseen",
    unseenNotifications(me) > 0 ? bell.className.includes("has") : !bell.className.includes("has"));

  // 2. Alerts got a grid badge for free by being an app
  ok("Alerts is in the app grid", APPS.some(a => a.id === "alerts"));

  // 3. the aether meter -> a strip in Messages, shown only when the link is down
  game.users = userList([{ isGM: true, active: true, id: "gm1", character: null }]);
  ok("no aether strip while a GM is connected",
    !draw(uiFor(me), "_app_messages").querySelector(".zsm-aether"));

  game.users = userList([{ isGM: true, active: false, id: "gm1", character: null }]);
  ok("the aether strip appears when no GM is connected",
    !!draw(uiFor(me), "_app_messages").querySelector(".zsm-aether"));

  // 4. the clock and the charge meter were duplicates, and are simply gone
  ok("nothing renders a charge meter any more",
    typeof ScrollUI.prototype._charge === "undefined");
  ok("nothing renders a status bar any more",
    typeof ScrollUI.prototype._statusBar === "undefined");
}

console.log("\n[ui] the app bar centres its title with a real grid");
{
  const c = makeEl("div");
  const bar = uiFor(me)._appBar(c, "Schedule");
  ok("three cells: back, title, trailing", bar.children.length === 3);
  ok("the trailing cell exists even with no trailing control", !!bar.querySelector(".zsu-aptail"));
  ok("and reserves room for the floating close button", !!bar.querySelector(".zsu-apbspacer"));

  const c2 = makeEl("div");
  const withTrailing = uiFor(me)._appBar(c2, "Messages", makeEl("button"));
  ok("a trailing control does not add a fourth cell", withTrailing.children.length === 3);
}

console.log("\n[ui] contact tooltips no longer live inside the scroller");
{
  const c = draw(uiFor(me, { relContact: null }), "_app_contacts");
  ok("no tooltip node is rendered into the clipping scroller",
    c.querySelectorAll(".zsr-vn-tip").length === 0);
}

console.log("\n[ui] the Bank app");
{
  me.items = [makeItem("marks", 120), makeItem("astras", 8)];
  await grantCurrency(me, "astras", 5, "Duelling purse");

  const c = draw(uiFor(me), "_app_bank");
  ok("one card per configured currency", c.querySelectorAll(".zsk-card").length === 2);
  ok("the balances are shown", textOf(c).includes("120") && textOf(c).includes("13"));
  ok("the ledger lists the grant", textOf(c).includes("Duelling purse"));

  const broke = makeActor("Penniless");
  ok("a student with no ledger gets the empty state rather than an error",
    !!draw(uiFor(broke), "_app_bank").querySelector(".zs-empty"));
}

console.log("\n[ui] the Student ID card follows the primary currency");
{
  const saved = settings.currencies;
  settings.currencies = [
    { key: "astras", itemName: "astras", label: "Astras", primary: true },
    { key: "marks", itemName: "marks", label: "Marks", primary: false },
  ];
  ok("the stat row names whichever currency is primary",
    textOf(draw(uiFor(me), "_app_profile")).includes("ASTRAS"));
  settings.currencies = saved;
  ok("and goes back when the primary does",
    textOf(draw(uiFor(me), "_app_profile")).includes("MARKS"));
}

console.log("\n[ui] full frame render and navigation");
{
  let threw = null;
  let v = null;
  try {
    v = uiFor(me, { open_: true, view: "home" });
    v.render();
  } catch (e) { threw = e; }
  ok("render() builds the whole projection", !threw, threw && (threw.constructor.name + ": " + threw.message));

  if (v?.el) {
    ok("the status bar is gone", !v.el.querySelector(".zsu-statusbar"));
    ok("the frame carries a dock and a close control",
      !!v.el.querySelector(".zsu-dock") && !!v.el.querySelector(".zsu-close"));
    ok("the close control sits inside the screen, not outside the frame",
      !!v.el.querySelector(".zsu-screen")?.querySelector(".zsu-close"));
    ok("exactly one view is on the stage", v.stage.children.length === 1);

    const frameBefore = v.el;
    v.go("app", "schedule", "fwd");
    ok("navigating swaps the view without rebuilding the frame", v.el === frameBefore);

    // Both views are on the stage while they cross over — that IS the transition.
    // The outgoing one leaves on animationend, with a timer as the backstop for
    // when that never fires (backgrounded tab, motion overridden mid-flight).
    ok("the outgoing view overlaps the incoming one during the transition",
      v.stage.children.length === 2, "got " + v.stage.children.length);
    await new Promise(r => setTimeout(r, 450));
    ok("the outgoing view is cleaned up even without an animationend",
      v.stage.children.length === 1, "got " + v.stage.children.length);

    v.back();
    ok("back returns to the home grid", v.view === "home" && v.appId === null);

    v.go("app", "messages", "fwd");
    v.convId = "c-days";
    v.back();
    ok("back inside an app closes the detail first", v.convId === null && v.appId === "messages");

    v._stopClock();
    v.close();
  }
}

console.log("\n[ui] transitions that get interrupted");
{
  const v = uiFor(me, { open_: true, view: "home" });
  v.render();

  // Three moves inside one 400ms transition window. The stage used to grow by
  // one orphan per interrupted move, each stuck at full opacity under the live
  // view, because the outgoing view was looked up as `firstElementChild`.
  v.go("app", "schedule", "fwd");
  v.go("app", "gift", "fwd");
  v.go("app", "bank", "fwd");
  ok("interrupted transitions never stack more than the pair crossing over",
    v.stage.children.length === 2, "got " + v.stage.children.length);

  const live = v.stage.lastElementChild;
  await new Promise(r => setTimeout(r, 450));
  ok("the stage settles back to a single view",
    v.stage.children.length === 1, "got " + v.stage.children.length);
  ok("and the view left standing is the one navigated to",
    v.stage.children[0] === live);

  // Reaching for "reduce motion" while a view was sliding used to be the one
  // gesture guaranteed to leave two screens on top of each other: .zs-calm
  // cancels the animation, so `animationend` never fired and the outgoing view
  // sat there at full opacity until the 400ms backstop caught up.
  v.go("app", "schedule", "back");
  ok("a transition is genuinely in flight", v.stage.children.length === 2);
  v.setCalm(true);
  ok("switching motion off settles the stage on the spot",
    v.stage.children.length === 1, "got " + v.stage.children.length);
  ok("and clears the transition classes from the view left standing",
    !/zsv-/.test(String(v.stage.children[0].className)),
    String(v.stage.children[0].className));
  ok("the frame carries the calm class", v.el.classList.contains("zs-calm"));
  v.setCalm(false);
  ok("and gives it back", !v.el.classList.contains("zs-calm"));

  // Closing leaves a full-screen backdrop fading for 320ms. Reopening inside
  // that window used to stack a second one over it, still eating the clicks.
  v._stopClock();
  v.close();
  ok("closing leaves the projection fading rather than gone", !!v._dying);
  v.show(me);
  ok("reopening inside the fade retires the old projection", v._dying === null);
  ok("exactly one projection is on the page",
    document.querySelectorAll("#zs-ui").length === 1,
    "got " + document.querySelectorAll("#zs-ui").length);

  v._stopClock();
  v.close();
}

console.log("\n[icon] position, recentring and the clamp");
{
  const icon = new ScrollIcon();
  icon.inject();
  ok("the bracelet is on the page", !!document.getElementById("zs-icon"));

  icon.centre();
  const pos = game.user.getFlag("zenith-scroll", "iconPosition");
  // A 64x64 stub rect in a 1600x900 stub viewport.
  ok("centre() puts the bracelet in the middle of the viewport",
    pos?.x === 768 && pos?.y === 418, JSON.stringify(pos));
  ok("and moves the element to match",
    icon.el.style.left === "768px" && icon.el.style.top === "418px");

  // A position saved on a wider monitor, reopened on a narrower one.
  icon.el.getBoundingClientRect = () => ({ left: 3000, top: 2000, width: 64, height: 64 });
  icon.clampIntoView();
  const back = game.user.getFlag("zenith-scroll", "iconPosition");
  ok("a bracelet off the edge of the viewport is pulled back inside",
    back?.x === 1528 && back?.y === 828, JSON.stringify(back));

  // Already inside: no write, so dragging a window wider doesn't spam the flag.
  icon.el.getBoundingClientRect = () => ({ left: 400, top: 300, width: 64, height: 64 });
  icon.clampIntoView();
  ok("a bracelet already inside is left exactly where it is",
    game.user.getFlag("zenith-scroll", "iconPosition")?.x === 1528);

  // A drag in progress owns the position; the clamp must not fight it.
  icon._dragged = true;
  icon.el.getBoundingClientRect = () => ({ left: 3000, top: 2000, width: 64, height: 64 });
  icon.clampIntoView();
  ok("the clamp keeps out of the way of a drag in progress",
    game.user.getFlag("zenith-scroll", "iconPosition")?.x === 1528);
  icon._dragged = false;

  icon.el.remove();
}

console.log("\n[init] the recentre button and its shortcut");
{
  // registerMenu only accepts an ApplicationV2 subclass, so the module builds
  // its menu class against whatever the running core provides.
  globalThis.foundry = { applications: { api: { ApplicationV2: class {} } } };
  let threw = null;
  try { hooks.find(h => h[0] === "init")[1](); } catch (e) { threw = e; }
  ok("init runs", !threw, threw && (threw.constructor.name + ": " + threw.message));

  const menu = game.settings._menus.find(m => m.k === "recentreScroll");
  ok("the settings sheet gets a Recentre the Scroll button", !!menu);
  ok("every player can reach it, not just the GM", menu?.d.restricted === false);
  ok("its type is an ApplicationV2 subclass, as registerMenu demands",
    !!menu && menu.d.type.prototype instanceof globalThis.foundry.applications.api.ApplicationV2);

  const key = game.keybindings._reg.find(k => k.k === "recentreScroll");
  ok("Shift+G is registered as a rebindable keybinding",
    key?.d.editable?.[0]?.key === "KeyG" && !!key?.d.editable?.[0]?.modifiers?.includes("Shift"));
  ok("and it is not GM-only either", key?.d.restricted === false);

  // Clicking the button is Foundry rendering a fresh instance of the menu class.
  app.icon = new ScrollIcon();
  app.icon.inject();
  app.icon._place(10, 10);
  await new menu.d.type().render();
  ok("rendering the menu recentres the bracelet rather than opening a form",
    game.user.getFlag("zenith-scroll", "iconPosition")?.x === 768);

  // And so is pressing the shortcut.
  app.icon._place(10, 10);
  ok("the keybinding handler consumes the key", key.d.onDown() === true);
  ok("and recentres the bracelet too",
    game.user.getFlag("zenith-scroll", "iconPosition")?.x === 768);

  app.icon.el.remove();
  app.icon = null;
}

console.log("\n[coverage] every GM Command Center section renders");
game.user.isGM = true;
const gm = new GMPanel();
gm.actor = me;
for (const section of GM_TABS.map(t => t[0])) {
  let threw = null;
  try { gm.section = section; gm.render(); } catch (e) { threw = e; }
  ok("GMPanel renders " + section, !threw, threw && (threw.constructor.name + ": " + threw.message));
}

/*
 * The Gift tab is two panes behind one tab and the tab list only names one of
 * them, so the loop above renders the student pane and would never touch the
 * editor. The board is the most breakable thing in the Command Center.
 */
{
  gm.section = "gift";
  gm.giftSub = "trees";
  await setGiftTrees([{
    id: "cov", name: "Coverage", nodes: [
      { id: "a", name: "A", cost: 0, requires: [], x: 50, y: 10 },
      { id: "b", name: "B", cost: 2, requires: ["a"], x: 30, y: 40,
        grants: [{ uuid: "Compendium.pf2e.feats-srd.Item.EMBERFIST", name: "Ember Fist" }] },
    ],
  }]);

  let threw = null;
  try { gm.render(); } catch (e) { threw = e; }
  ok("GMPanel renders the tree editor", !threw, threw && (threw.constructor.name + ": " + threw.message));
  ok("the board drew a node per node", gm.el.querySelectorAll(".zgt-node").length === 2);
  ok("and an edge for the requirement", gm.el.querySelectorAll(".zgt-edge").length === 1);
  ok("a node carrying grants is marked as such",
    gm.el.querySelectorAll(".zgt-grantmark").length === 1);
  ok("a playable tree reports no problems", gm.el.querySelectorAll(".zgt-ok").length === 1);

  gm.nodeSel = "b";
  gm.render();
  ok("selecting a node fills the inspector", gm.el.querySelectorAll(".zgt-drop").length === 1);
  ok("and shows what it already grants", gm.el.querySelectorAll(".zgt-gname").length === 1);

  await setGiftTrees([{
    id: "cov", name: "Coverage", nodes: [
      { id: "a", name: "A", cost: 0, requires: ["b"] },
      { id: "b", name: "B", cost: 1, requires: ["a"] },
    ],
  }]);
  gm.nodeSel = null;
  gm.render();
  ok("a broken tree lists its problems instead",
    gm.el.querySelectorAll(".zgt-prob").length > 0 && gm.el.querySelectorAll(".zgt-ok").length === 0);

  gm.giftSub = "student";
  await setGiftTrees([]);
}
gm.close();

console.log("\n[coverage] macro API");
game.users = userList([{ isGM: true, active: true, id: "gm1", character: null },
                       { isGM: false, active: true, id: "u2", character: me }]);
me._flags.social.relationships = [{ name: "Prof. Hale", title: "Instructor", rank: 2, category: "Faculty", history: [] }];
for (const [label, fn] of [
  ["sendNPCMessage", () => ZenithAPI.sendNPCMessage("Rin Adler", "Prof. Hale", "Report to my office.")],
  ["adjustRelationship", () => ZenithAPI.adjustRelationship("Rin Adler", "Prof. Hale", 1, "Covered for her")],
  ["addGalleryImage", () => ZenithAPI.addGalleryImage("Rin Adler", "b.webp", "Second")],
  ["postNotice", () => ZenithAPI.postNotice("Duelling hall closed.")],
  ["setSchoolEvent", () => ZenithAPI.setSchoolEvent("Third Examination", 5)],
  ["advanceDay", () => ZenithAPI.advanceDay(1)],
  ["clearSchoolEvent", () => ZenithAPI.clearSchoolEvent("Third Examination")],
]) {
  let threw = null;
  try { await fn(); } catch (e) { threw = e; }
  ok("ZenithAPI." + label + " runs", !threw, threw && (threw.constructor.name + ": " + threw.message));
}
ok("adjustRelationship moved the rank and logged history", (() => {
  const r = loadSection(me, "social").relationships.find(x => x.name === "Prof. Hale");
  return r && r.rank === 3 && r.history.some(h => h.includes("Covered for her"));
})());
ok("an NPC message also lands in the notification centre",
  getNotifications(me).some(n => n.title === "Prof. Hale" && n.app === "messages"));

console.log("\n[api] the deprecated event signature still works");
{
  const realWarn = console.warn;
  console.warn = () => {};
  await ZenithAPI.setEvent("Rin Adler", "Legacy Event", 3);
  console.warn = realWarn;
  ok("setEvent(actor, name, days) writes world content now",
    getEvents().some(e => e.name === "Legacy Event" && e.days === 3));
}

// =========================================================================
console.log("\n[socket] GM relay");
const handlers = [];
const emitted = [];
game.socket = { on: (_ch, fn) => handlers.push(fn), emit: (_ch, p) => emitted.push(p) };
initSocket();
ok("relay handler registered", handlers.length === 1);

const target = makeActor("Ilya Vance");
actors.length = 0;
actors.push(me, target);
game.users = userList([{ isGM: true, active: true, id: "gm1", character: null },
              { isGM: false, active: true, id: "u2", character: me }]);
game.user.isGM = true;
game.user.id = "gm1";

const relay = handlers[0];
const payload = (over = {}) => ({
  type: "sendMessage", convId: "c-relay",
  participants: ["Rin Adler", "Ilya Vance"], title: null, isGroup: false,
  message: { from: "Rin Adler", text: "meet me", time: "2 PM", ts: 4242, image: "" },
  targetActorIds: [target.id], senderName: "Rin Adler", userId: "u2", ...over,
});

await relay(payload());
const got = loadSection(target, "social").conversations.find(c => c.id === "c-relay");
ok("a verified message reaches the recipient's flags", !!got && got.messages[0].text === "meet me");
ok("relayed message keeps its sort timestamp", got?.messages[0].ts === 4242);
ok("relayed message is marked unread and inbound",
  got?.messages[0].read === false && got?.messages[0].sent === false);
ok("the relay writes the recipient's notification log too",
  getNotifications(target).some(n => n.app === "messages" && n.title === "Rin Adler"));

const before = loadSection(target, "social").conversations.length;

// The refusal paths log to console.warn by design; keep the run readable.
const realWarn = console.warn;
console.warn = () => {};

await relay(payload({ userId: "nobody", convId: "c-spoof" }));
ok("a message from an unknown user is refused",
  loadSection(target, "social").conversations.length === before);

await relay(payload({ senderName: "Someone Else", convId: "c-spoof2" }));
ok("a message naming an actor that does not exist is refused",
  loadSection(target, "social").conversations.length === before);

settings.enablePlayerMessaging = false;
await relay(payload({ convId: "c-disabled" }));
ok("the relay refuses when messaging is turned off",
  loadSection(target, "social").conversations.length === before);
settings.enablePlayerMessaging = true;
console.warn = realWarn;

// Extra fields on the wire must not reach actor flags
await relay(payload({ convId: "c-extra", message: { from: "Rin Adler", text: "hi", evil: "<script>" } }));
const extraConv = loadSection(target, "social").conversations.find(c => c.id === "c-extra");
ok("only known message fields are stored",
  !!extraConv && !("evil" in extraConv.messages[0]) &&
  eq(Object.keys(extraConv.messages[0]).sort(), ["from", "image", "read", "sent", "text", "time", "ts"]));

console.log("\n[socket] muting silences the toast, not the delivery");
{
  // The refresh branch runs on the recipient's own client.
  game.user.isGM = false;
  game.user.id = "u2";
  game.user.character = target;
  game.users = userList([{ isGM: true, active: true, id: "gm1", character: null },
                         { isGM: false, active: true, id: "u2", character: target }]);

  const social = loadSection(target, "social");
  social.conversations.find(c => c.id === "c-relay").muted = true;
  await saveSection(target, "social", social);

  document.getElementById("zs-toasts")?.remove();
  await relay({ type: "refresh", actorIds: [target.id], convId: "c-relay", senderName: "Rin Adler" });
  ok("a muted conversation raises no toast", !document.getElementById("zs-toasts"));

  await relay({ type: "refresh", actorIds: [target.id], convId: "c-extra", senderName: "Rin Adler" });
  ok("an unmuted conversation still raises one", !!document.getElementById("zs-toasts"));
  document.getElementById("zs-toasts")?.remove();
}

// =========================================================================
// Last, because the clear removes every flag in the world and nothing after it
// would have anything left to read.
console.log("\n[danger] portrait refresh");
{
  game.user.isGM = true;
  const social = loadSection(me, "social");
  social.relationships = [
    { name: "Prof. Hale", title: "", img: "stale/old.webp", rank: 0, category: "Faculty", history: [] },
    { name: "Nobody At All", title: "", img: "hand/typed.webp", rank: 0, category: "Other", history: [] },
  ];
  await saveSection(me, "social", social);

  const hale = makeActor("Prof. Hale");
  actors.push(hale);

  const n = await refreshPortraits();
  const after = loadSection(me, "social").relationships;
  ok("a contact with a matching actor is brought up to date",
    after[0].img === "token/Prof. Hale.webp", after[0].img);
  ok("a hand-typed portrait with no actor behind it is left alone",
    after[1].img === "hand/typed.webp");
  ok("it reports how many actors it touched", n >= 1);
}

console.log("\n[danger] export");
{
  const dump = exportScrollData();
  ok("the export names the module and the world",
    dump.module === "zenith-scroll" && dump.world === "zenith-test");
  ok("it carries a timestamp", typeof dump.exportedAt === "string" && dump.exportedAt.includes("T"));
  ok("it captures the actors that hold scroll data", dump.actors.length >= 1);

  const mine = dump.actors.find(a => a.name === "Rin Adler");
  ok("an actor's sections come across", !!mine?.flags.social && !!mine?.flags.profile);
  ok("the flags are a copy, not a live reference",
    mine.flags.social !== me._flags.social);
  ok("world content is included by default",
    Array.isArray(dump.worldContent?.announcements) && Array.isArray(dump.worldContent?.events));
  ok("and can be left out",
    exportScrollData({ includeWorld: false }).worldContent === undefined);
}

console.log("\n[core] image paths off the wire");
{
  ok("an ordinary Foundry path passes", safeImageSrc("scroll-gallery/duel.webp") === "scroll-gallery/duel.webp");
  ok("an https url passes", safeImageSrc("https://cdn.example/x.png") === "https://cdn.example/x.png");
  ok("javascript: is refused", safeImageSrc("javascript:alert(1)") === "");
  ok("data: is refused, so nobody writes a megabyte into someone's flags",
    safeImageSrc("data:image/png;base64,AAAA") === "");
  ok("a protocol-relative url is refused", safeImageSrc("//evil.example/x.png") === "");
  ok("climbing out of the data dir is refused", safeImageSrc("../../secrets/x.png") === "");
  ok("empty stays empty", safeImageSrc(null) === "" && safeImageSrc("  ") === "");
}

console.log("\n[gallery] filing, ordering and removing");
{
  const gal = makeActor("Gallery Test");
  actors.push(gal);

  await addGalleryImage(gal, { src: "a.webp", caption: "First", ts: 1000 });
  await addGalleryImage(gal, { src: "b.webp", caption: "Second", ts: 3000, from: "Rin Adler" });
  await addGalleryImage(gal, { src: "c.webp", caption: "Third", ts: 2000 });

  const list = getGallery(gal);
  ok("the gallery comes back newest first",
    list.map(g => g.caption).join(",") === "Second,Third,First", list.map(g => g.caption).join(","));
  ok("every entry gets an id to be addressed by", list.every(g => !!g.id));
  ok("a shared image remembers who sent it", list[0].from === "Rin Adler");

  ok("an image with no src is not filed", await addGalleryImage(gal, { src: "" }) === null);

  const removed = await removeGalleryImage(gal, list[0].id);
  ok("removing by id works", removed === true && getGallery(gal).length === 2);
  ok("removing something that isn't there says so",
    await removeGalleryImage(gal, "img_nope") === false);

  // Pre-v1.9 rows are bare {src, caption} with no id and no ts.
  const legacy = makeActor("Legacy Gallery", { media: { gallery: [{ src: "old.webp", caption: "Old" }] } });
  actors.push(legacy);
  ok("a pre-v1.9 gallery still reads", getGallery(legacy)[0].caption === "Old");
  ok("and its rows can still be removed, by src",
    await removeGalleryImage(legacy, "old.webp") === true && getGallery(legacy).length === 0);
}

console.log("\n[gallery] the GM pushing one image to everyone");
{
  const a = makeActor("Push One");
  const b = makeActor("Push Two");
  actors.push(a, b);
  game.users.push({ id: "up1", isGM: false, active: true, character: a, name: "P1" });
  game.users.push({ id: "up2", isGM: false, active: true, character: b, name: "P2" });

  const wasGM = game.user.isGM;
  game.user.isGM = false;
  ok("a player cannot push to everyone", await pushImageToAll("x.webp", "no") === 0);

  game.user.isGM = true;
  const students = new Set(game.users.filter(u => !u.isGM && u.character).map(u => u.character.id));
  const n = await pushImageToAll("scroll-gallery/party.webp", "The whole year, first term");
  ok("the GM reaches every student", n === students.size, `${n} of ${students.size}`);
  ok("the image lands in each gallery",
    getGallery(a)[0].src === "scroll-gallery/party.webp" &&
    getGallery(b)[0].caption === "The whole year, first term");
  ok("and each of them is told about it",
    getNotifications(a)[0]?.app === "gallery" && getNotifications(b)[0]?.app === "gallery");

  ok("a path that cannot be used is refused rather than filed",
    await pushImageToAll("javascript:alert(1)", "") === 0);

  // Two users on one character should not get the image twice.
  game.users.push({ id: "up3", isGM: false, active: true, character: a, name: "P1 second seat" });
  const before = getGallery(a).length;
  await pushImageToAll("scroll-gallery/again.webp", "Once");
  ok("a character played by two users is only filed once",
    getGallery(a).length === before + 1, `${before} -> ${getGallery(a).length}`);

  game.user.isGM = wasGM;
}

console.log("\n[notes] plain text and the HTML a journal page stores");
{
  ok("a paragraph round-trips",
    htmlToText(textToHtml("One line")) === "One line");
  ok("a blank line stays a blank line",
    htmlToText(textToHtml("First\n\nSecond")) === "First\n\nSecond");
  ok("a single newline stays a single newline",
    htmlToText(textToHtml("First\nSecond")) === "First\nSecond");
  ok("angle brackets survive being escaped and read back",
    htmlToText(textToHtml("a < b & c > d")) === "a < b & c > d");
  ok("empty text makes no markup", textToHtml("   ") === "");

  ok("paragraphs and breaks count as plain",
    isPlainish("<p>Hello<br>there</p>") === true);
  ok("a table does not", isPlainish("<p>x</p><table><tr><td>1</td></tr></table>") === false);
  ok("an embedded image does not", isPlainish('<p><img src="x.png"></p>') === false);
  ok("a link does not", isPlainish('<a href="#">x</a>') === false);
  ok("nothing at all is plain", isPlainish("") === true && isPlainish(null) === true);
}

console.log("\n[notes] the notebook itself");
{
  const student = makeActor("Note Taker");
  actors.push(student);
  game.users.push({ id: "un1", isGM: false, active: true, character: student, name: "Notes Player" });

  const wasGM = game.user.isGM;
  game.user.isGM = false;
  ok("a player finds no notebook before one is issued", notebookFor(student) === null);
  ok("and cannot conjure one", await ensureNotebook(student) === null);

  game.user.isGM = true;
  const book = await ensureNotebook(student);
  ok("the GM issues one", !!book);
  ok("it is filed under the actor, not the name", book.getFlag("zenith-scroll", "notebookFor") === student.id);
  ok("the player who plays them owns it", book.ownership.un1 === 3);
  ok("and nobody else does by default", book.ownership.default === 0);
  ok("issuing twice does not make two", (await ensureNotebook(student)) === book);

  game.user.isGM = false;
  ok("the player can now see it", notebookFor(student) === book);
  ok("and can write in it", canWrite(student) === true);

  const id = await createNote(student, "personal", "Term one");
  ok("a note can be started", !!id);
  ok("it shows up in the list", listNotes(student).some(n => n.id === id));
  ok("and is counted for the tab", noteCount(student, "personal") === 1);

  await saveNote(student, "personal", id, { text: "The tomb door opens inward.\n\nAsk Hale about the seal." });
  const saved = listNotes(student).find(n => n.id === id);
  ok("the text comes back as it was typed",
    saved.text === "The tomb door opens inward.\n\nAsk Hale about the seal.", JSON.stringify(saved.text));
  ok("and is stored as real journal HTML",
    book.pages.get(id).text.content.startsWith("<p>The tomb door"));

  await saveNote(student, "personal", id, { name: "The Tomb" });
  ok("a note can be renamed", listNotes(student).find(n => n.id === id).name === "The Tomb");

  // A page the GM has built something in must not be flattened by the textarea.
  const rich = await createNote(student, "personal", "Handout");
  await book.pages.get(rich).update({ "text.content": "<p>See</p><table><tr><td>1</td></tr></table>" });
  ok("a formatted page is flagged as such",
    listNotes(student).find(n => n.id === rich).rich === true);
  ok("and refuses a plain-text save rather than flattening it",
    await saveNote(student, "personal", rich, { text: "wiped" }) === false);
  ok("its content is untouched", book.pages.get(rich).text.content.includes("<table>"));
  ok("renaming it is still fine",
    await saveNote(student, "personal", rich, { name: "The Handout" }) === true);

  ok("notes come back most recently edited first",
    listNotes(student)[0].id === rich, listNotes(student)[0].name);

  ok("popping out renders the journal sheet", popOut(student, "personal", id) === true);
  ok("and asks for the right page", journalRenders.at(-1).opts?.pageId === id);

  ok("a note can be deleted", await deleteNote(student, "personal", rich) === true);
  ok("and is then gone", !listNotes(student).some(n => n.id === rich));
  ok("deleting one that is gone says so", await deleteNote(student, "personal", rich) === false);

  // A page nobody may write is read-only in the app rather than a failed save.
  book.pages.get(id)._locked = true;
  ok("a page the user cannot modify is reported read-only",
    listNotes(student).find(n => n.id === id).editable === false);
  book.pages.get(id)._locked = false;

  game.user.isGM = wasGM;
}

console.log("\n[camera] the parts that don't need a GPU");
{
  ok("there is nothing to photograph without a canvas", canCapture() === false);
  ok("captures are filed under the gallery folder",
    captureDir() === "scroll-gallery/captures", captureDir());

  const name = captureName(actors[0]);
  ok("a capture filename carries the actor and sorts by date",
    name.startsWith("zs-" + actors[0].id + "-") && name.endsWith(".jpg"), name);
  ok("two captures a moment apart do not collide",
    captureName(actors[0]) !== "zs-x-.jpg" && /\d{4}-\d{2}-\d{2}T/.test(name), name);

  ok("a player with no upload permission is routed through the GM",
    canUploadDirectly() === false);
}

console.log("\n[socket] sharing an image between students");
{
  const from = game.actors.getName("Rin Adler");
  const to = makeActor("Share Target");
  actors.push(to);
  game.users.push({ id: "us1", isGM: false, active: true, character: from, name: "Sharer" });

  const wasGM = game.user.isGM;
  game.user.isGM = true;
  const relay = handlers[0];

  await relay({
    type: "shareImage", userId: "us1", senderName: from.name,
    targetActorIds: [to.id], src: "scroll-gallery/duel.webp", caption: "The duel",
  });
  const got = getGallery(to)[0];
  ok("the image reaches the recipient's gallery", got?.src === "scroll-gallery/duel.webp");
  ok("it says who sent it", got?.from === from.name);
  ok("and the recipient is told", getNotifications(to)[0]?.title === from.name);
  ok("the alert points at the gallery", getNotifications(to)[0]?.app === "gallery");

  const before = getGallery(to).length;
  await relay({
    type: "shareImage", userId: "nobody", senderName: from.name,
    targetActorIds: [to.id], src: "x.webp",
  });
  ok("an unknown user is refused", getGallery(to).length === before);

  await relay({
    type: "shareImage", userId: "us1", senderName: from.name,
    targetActorIds: [to.id], src: "javascript:alert(1)",
  });
  ok("an unusable path is refused at the relay too", getGallery(to).length === before);

  await relay({
    type: "shareImage", userId: "us1", senderName: from.name,
    targetActorIds: [to.id], src: "data:image/png;base64,AAAA",
  });
  ok("so is a data URL, which would be flag-sized", getGallery(to).length === before);

  // A capture is only written after the same ownership check.
  await relay({
    type: "storeCapture", userId: "nobody", actorId: to.id,
    dataUrl: "data:image/jpeg;base64,AAAA",
  });
  ok("a capture from an unverified user is refused", getGallery(to).length === before);

  await relay({
    type: "storeCapture", userId: "us1", actorId: to.id,
    dataUrl: "not-an-image",
  });
  ok("and so is anything that is not an image data URL", getGallery(to).length === before);

  game.user.isGM = wasGM;
}

console.log("\n[notes] the party notebook");
{
  const wasGM = game.user.isGM;
  const student = game.actors.getName("Note Taker");

  // A journal page records who last wrote it, and the app resolves that id to a
  // name — so whoever this session is has to be findable in `game.users`. Blocks
  // above reassign both `game.user` and `game.users`, so read the id rather than
  // assuming it, and put the user back rather than seeding one at the top.
  if (!game.users.get(game.user.id)) {
    game.users.push({ id: game.user.id, isGM: false, active: true, character: null });
  }
  game.users.get(game.user.id).name = "Player One";

  game.user.isGM = false;
  ok("there is no party notebook until a GM makes one", partyNotebook() === null);
  ok("and a player cannot make one", await ensurePartyNotebook() === null);

  game.user.isGM = true;
  const party = await ensurePartyNotebook();
  ok("the GM opens one", !!party);
  ok("everyone owns it — that is the whole difference", party.ownership.default === 3);
  ok("making it twice does not make two", await ensurePartyNotebook() === party);
  ok("it is found by flag, not by name", party.getFlag("zenith-scroll", "partyNotebook") === true);

  game.user.isGM = false;
  ok("bookFor routes to the right book",
    bookFor(student, "party") === party && bookFor(student, "personal") === notebookFor(student));
  ok("an unrecognised book falls back to personal",
    bookFor(student, "nonsense") === notebookFor(student));
  ok("there are two books to choose between", BOOKS.length === 2 && BOOKS[0].id === "personal");

  const pid = await createNote(student, "party", "Where the tomb is");
  ok("a party note can be started", !!pid);
  ok("it is in the party book", listNotes(student, "party").some(n => n.id === pid));
  ok("and not in the personal one", !listNotes(student, "personal").some(n => n.id === pid));
  ok("the tab counters count separately",
    noteCount(student, "party") === 1 && noteCount(student, "personal") >= 1);

  await saveNote(student, "party", pid, { text: "Third bell, behind the chapel." });
  const note = listNotes(student, "party").find(n => n.id === pid);
  ok("a party note says who wrote it last", note.by === "Player One", JSON.stringify(note.by));
  ok("a personal note does not, because there is only one candidate",
    listNotes(student, "personal")[0].by === "");

  ok("popping out opens the party journal",
    popOut(student, "party") === true && journalRenders.at(-1).name === "Party Notes");

  ok("a party note can be deleted", await deleteNote(student, "party", pid) === true);
  ok("and provisioning counts the party book too",
    (game.user.isGM = true, await provisionNotebooks()) >= 2);

  game.user.isGM = wasGM;
}

console.log("\n[camera] photos still in the darkroom");
{
  for (const d of developing()) finishDeveloping(d.id);
  ok("the darkroom starts empty", developing().length === 0);

  const id = beginDeveloping("data:image/jpeg;base64,AAAA", "The duel");
  ok("a sent capture is tracked", developing().length === 1);
  ok("the tile carries the photo itself, not a placeholder",
    developing()[0].dataUrl === "data:image/jpeg;base64,AAAA");
  ok("and its caption", developing()[0].caption === "The duel");
  ok("it is not a failure yet", developing()[0].failed === false);

  const second = beginDeveloping("data:image/jpeg;base64,BBBB", "");
  ok("two at once are both tracked", developing().length === 2);
  ok("newest first", developing()[0].id === second);

  ok("a failure marks the tile rather than dropping it",
    failDeveloping(id, "Disk full") === true && developing().length === 2);
  const failed = developing().find(d => d.id === id);
  ok("and says why", failed.failed === true && failed.reason === "Disk full");
  ok("failing one that isn't there says so", failDeveloping("dev_nope") === false);

  ok("arriving takes it out of the darkroom",
    finishDeveloping(second) === true && developing().length === 1);
  ok("and so does dismissing a failed one",
    finishDeveloping(id) === true && developing().length === 0);

  // The relay hands the photographer's own token back, which is how the right
  // tile comes out of the darkroom when two are in flight.
  const mine = beginDeveloping("data:image/jpeg;base64,CCCC", "");
  const theirs = beginDeveloping("data:image/jpeg;base64,DDDD", "");
  finishDeveloping(theirs);
  ok("only the one the GM answered about is cleared",
    developing().length === 1 && developing()[0].id === mine);
  finishDeveloping(mine);
}

console.log("\n[sweep] captures nobody has in their gallery");
{
  const wasGM = game.user.isGM;

  ok("a capture filename gives up the actor it was taken for",
    ownerOfCapture("scroll-gallery/captures/zs-aBcD1234-2026-09-08T10-00-00.jpg") === "aBcD1234");
  ok("an id with a hyphen in it survives being read back",
    ownerOfCapture("scroll-gallery/captures/zs-actor-rin-adler-2026-09-08T10-00-00.jpg") === "actor-rin-adler");
  ok("something that is not one of ours gives up nothing",
    ownerOfCapture("scroll-gallery/holiday.png") === null);

  game.user.isGM = false;
  ok("a player cannot sweep", (await findOrphanCaptures()).error !== "");

  game.user.isGM = true;
  const owner = game.actors.getName("Rin Adler");
  // The real shape: zs-<actor id>-<ISO stamp>.jpg, and this fixture's ids carry
  // a hyphen, which is exactly the case that reading up to the first one breaks.
  const kept = `scroll-gallery/captures/zs-${owner.id}-2026-09-08T10-00-00.jpg`;
  const lost = `scroll-gallery/captures/zs-${owner.id}-2026-09-08T11-30-00.jpg`;
  const alien = "scroll-gallery/captures/someone-elses.png";

  await addGalleryImage(owner, { src: kept, caption: "Still filed" });
  browseResult = { files: [kept, lost, alien] };

  const res = await findOrphanCaptures();
  ok("every file in the folder is counted", res.total === 3, "counted " + res.total);
  ok("a file still in a gallery is not an orphan", !res.orphans.some(o => o.path === kept));
  ok("one nothing points at is", res.orphans.some(o => o.path === lost));
  ok("so is a stray that was never ours", res.orphans.some(o => o.path === alien));
  ok("an orphan names the student it was taken for",
    res.orphans.find(o => o.path === lost)?.owner === owner.name);
  ok("and admits when it cannot", res.orphans.find(o => o.path === alien)?.owner === "");

  // FilePicker percent-encodes what it returns; a flag holds what was written.
  const spaced = "scroll-gallery/captures/zs-x-a b.jpg";   // not our naming, but a real file
  await addGalleryImage(owner, { src: spaced, caption: "Spaces" });
  browseResult = { files: ["scroll-gallery/captures/zs-x-a%20b.jpg"] };
  ok("an encoded path still matches the flag that spells it out",
    (await findOrphanCaptures()).orphans.length === 0);

  const script = deletionScript(res.orphans);
  ok("the delete script names every checked file",
    res.orphans.every(o => script.includes(o.path)), script);
  ok("it says where to run it", script.includes("Data folder"));
  ok("it quotes for PowerShell by default", script.includes("Remove-Item -LiteralPath"));
  ok("and can speak sh instead",
    deletionScript(res.orphans, { shell: "bash" }).includes('rm -f "'));

  browseResult = null;
  ok("a world that has never taken a photo is not an error, just empty",
    (await findOrphanCaptures()).error.includes("does not exist"));

  game.user.isGM = wasGM;
}

console.log("\n[sweep] everything an image can be referenced from");
{
  const wasGM = game.user.isGM;
  game.user.isGM = true;

  const holder = game.actors.getName("Rin Adler");
  const inGallery = "scroll-gallery/captures/zs-a-2026-01-01T00-00-00.jpg";
  const inMessage = "scroll-gallery/captures/zs-b-2026-01-02T00-00-00.jpg";
  const onAMap = "scroll-gallery/captures/zs-c-2026-01-03T00-00-00.jpg";
  const nowhere = "scroll-gallery/captures/zs-d-2026-01-04T00-00-00.jpg";

  await addGalleryImage(holder, { src: inGallery, caption: "Filed" });

  // A capture attached to a message and then tidied out of the gallery is still
  // on screen in the thread. Deleting it would break the message.
  const social = loadSection(holder, "social");
  social.conversations.push({
    id: "conv-sweep", participants: [holder.name, "Prof. Hale"], title: null, isGroup: false,
    messages: [{ from: holder.name, text: "look", time: "", ts: 1, image: inMessage, sent: true, read: true }],
    muted: false,
  });
  await saveSection(holder, "social", social);

  await setMaps([{
    id: "map-sweep", name: "The Tomb", img: "maps/tomb.webp", published: true,
    pins: [{ id: "pin1", x: 10, y: 20, label: "Door", note: "", icon: "fa-door-open", img: onAMap, found: true }],
  }]);

  browseResult = { files: [inGallery, inMessage, onAMap, nowhere] };
  const res = await findOrphanCaptures();

  ok("a capture still in a gallery is not an orphan", !res.orphans.some(o => o.path === inGallery));
  ok("nor is one attached to a message", !res.orphans.some(o => o.path === inMessage));
  ok("nor is one pinned to a map", !res.orphans.some(o => o.path === onAMap));
  ok("the one nothing points at is", res.orphans.length === 1 && res.orphans[0].path === nowhere,
    JSON.stringify(res.orphans.map(o => o.path)));

  const refs = referencedImages();
  ok("referencedImages sees all three", refs.has(inGallery) && refs.has(inMessage) && refs.has(onAMap));
  ok("and the map's own image too", refs.has("maps/tomb.webp"));

  browseResult = null;
  await setMaps([]);
  game.user.isGM = wasGM;
}

console.log("\n[maps] world content, and what students are allowed to see");
{
  const wasGM = game.user.isGM;

  game.user.isGM = false;
  await setMaps([{ id: "nope", name: "Sneaky", img: "", pins: [] }]);
  ok("a player cannot write the maps", getMaps().length === 0);

  game.user.isGM = true;
  await setMaps([
    {
      id: "m1", name: "The Academy", img: "maps/academy.webp", note: "Ground floor.", published: true,
      pins: [
        { id: "p1", x: 30, y: 40, label: "Duelling hall", note: "Third bell.", icon: "fa-hand-fist", found: true },
        { id: "p2", x: 900, y: -5, label: "The vault", note: "Locked.", found: false },
      ],
    },
    { id: "m2", name: "Draft", img: "", pins: [], published: false },
    { name: "", img: "x.webp", pins: [] },
  ]);

  const maps = getMaps();
  ok("a map with no name is dropped", maps.length === 2, "kept " + maps.length);
  ok("pins off the edge of the editor are clamped back on",
    maps[0].pins[1].x === 100 && maps[0].pins[1].y === 0,
    JSON.stringify([maps[0].pins[1].x, maps[0].pins[1].y]));
  ok("a pin keeps its icon", maps[0].pins[0].icon === "fa-hand-fist");
  ok("and gets a default one if it has none", maps[0].pins[1].icon === "fa-location-dot");

  const seen = visibleMaps();
  ok("an unpublished map never reaches a student", seen.length === 1 && seen[0].id === "m1");
  ok("an undiscovered pin is stripped before it is sent, not hidden with CSS",
    seen[0].pins.length === 1 && seen[0].pins[0].id === "p1");
  ok("the GM still sees both", getMaps()[0].pins.length === 2);

  ok("a map image that cannot be used is dropped, not rendered",
    (await setMaps([{ id: "m3", name: "Bad", img: "javascript:alert(1)", pins: [] }]),
     getMaps()[0].img === ""));

  await setMaps([]);
  game.user.isGM = wasGM;
}

console.log("\n[queue] messages written in advance");
{
  const wasGM = game.user.isGM;
  const a = game.actors.getName("Push One");
  const b = game.actors.getName("Push Two");

  game.user.isGM = false;
  await setQueued([{ id: "nope", from: "X", text: "no" }]);
  ok("a player cannot write the queue", getQueued().length === 0);

  game.user.isGM = true;
  await setQueued([
    { id: "q1", label: "The summons", from: "Headmaster", text: "See me at once.", to: "all" },
    { id: "q2", label: "Just her", from: "Prof. Hale", text: "Well done.", to: [a.id] },
    { id: "q3", from: "Nobody", text: "   " },
  ]);
  ok("an empty message is dropped", getQueued().length === 2, "kept " + getQueued().length);
  ok("nothing has been sent yet", getQueued().every(q => q.sentCount === 0));

  const students = new Set(game.users.filter(u => !u.isGM && u.character).map(u => u.character.id));
  const n = await ZenithAPI.sendQueued("q1");
  ok("sending to everyone reaches every student", n === students.size, `${n} of ${students.size}`);
  ok("it lands as a message from the right name",
    loadSection(a, "social").conversations.some(c => c.participants.includes("Headmaster")));
  ok("and raises an alert", getNotifications(a).some(x => x.title === "Headmaster"));

  ok("the entry stays, with a count",
    getQueued().find(q => q.id === "q1")?.sentCount === 1);
  ok("and remembers when", getQueued().find(q => q.id === "q1")?.lastSent > 0);

  ok("sending it again counts again",
    (await ZenithAPI.sendQueued("q1"), getQueued().find(q => q.id === "q1")?.sentCount === 2));

  const before = loadSection(b, "social").conversations.length;
  await ZenithAPI.sendQueued("q2");
  ok("a targeted message reaches only who it names",
    loadSection(a, "social").conversations.some(c => c.participants.includes("Prof. Hale")) &&
    loadSection(b, "social").conversations.length === before);

  ok("sending one that isn't there does nothing", await ZenithAPI.sendQueued("q-nope") === 0);

  await setQueued([{ id: "q4", from: "", text: "Nobody said this", to: "all" }]);
  ok("a message with no sender is refused rather than delivered anonymously",
    await ZenithAPI.sendQueued("q4") === 0);

  game.user.isGM = false;
  ok("a player cannot fire one", await ZenithAPI.sendQueued("q4") === 0);

  game.user.isGM = true;
  await setQueued([]);
  game.user.isGM = wasGM;
}

console.log("\n[messages] read receipts");
{
  const wasGM = game.user.isGM;
  const sender = game.actors.getName("Rin Adler");
  const reader = game.actors.getName("Share Target");

  // The sender's own copy of two messages, plus one they did not send.
  const ss = loadSection(sender, "social");
  ss.conversations = ss.conversations.filter(c => c.id !== "conv-receipt");
  ss.conversations.push({
    id: "conv-receipt", participants: [sender.name, reader.name], title: null, isGroup: false,
    messages: [
      { from: sender.name, text: "one", time: "", ts: 111, image: "", sent: true, read: true },
      { from: sender.name, text: "two", time: "", ts: 222, image: "", sent: true, read: true },
      { from: reader.name, text: "hi", time: "", ts: 333, image: "", sent: false, read: true },
    ],
    muted: false,
  });
  await saveSection(sender, "social", ss);

  game.user.isGM = true;
  const relay = handlers[0];

  await relay({
    type: "readReceipt", userId: "us1", readerName: reader.name, convId: "conv-receipt",
    marks: [{ from: sender.name, ts: 111 }],
  });

  const after = loadSection(sender, "social").conversations.find(c => c.id === "conv-receipt");
  ok("the message the reader opened is marked seen", after.messages[0].seen === true);
  ok("and says who saw it", after.messages[0].seenBy?.includes(reader.name));
  ok("a message they have not reached is untouched", !after.messages[1].seen);
  ok("an inbound message is never marked seen", !after.messages[2].seen);

  await relay({
    type: "readReceipt", userId: "nobody", readerName: reader.name, convId: "conv-receipt",
    marks: [{ from: sender.name, ts: 222 }],
  });
  ok("a receipt from an unverified reader is refused",
    !loadSection(sender, "social").conversations
      .find(c => c.id === "conv-receipt").messages[1].seen);

  // Reading twice must not stack the same name up.
  await relay({
    type: "readReceipt", userId: "us1", readerName: reader.name, convId: "conv-receipt",
    marks: [{ from: sender.name, ts: 111 }],
  });
  const again = loadSection(sender, "social").conversations.find(c => c.id === "conv-receipt");
  ok("reading the same message twice does not double the receipt",
    again.messages[0].seenBy.length === 1);

  await relay({
    type: "readReceipt", userId: "us1", readerName: reader.name, convId: "no-such-conv",
    marks: [{ from: sender.name, ts: 111 }],
  });
  ok("a receipt for a thread the sender does not have is harmless", true);

  game.user.isGM = wasGM;
}

// The v1.11 shape — a whole tree stored on the student — still renders in
// v1.12, composed as a local pseudo-tree. This block is the contract that says
// so: it is written entirely against the old API and never mentions the library.
console.log("\n[gift] a pre-v1.12 tree stored on the actor, still working");
{
  const student = game.actors.getName("Rin Adler");

  const blank = ZenithAPI.giftTreeTemplate();
  ok("the template has tiers to hang nodes on", blank.tiers.length >= 2);
  ok("and nothing on them", blank.nodes.length === 0 && blank.unlocked.length === 0);

  ok("a student with nothing stored still reads a valid tree",
    (() => { const t = getGiftTree(student); return Array.isArray(t.nodes) && Array.isArray(t.tiers); })());

  await setGiftTree(student, {
    tiers: [{ key: "root", label: "Awakening" }, { key: "t1", label: "" }],
    nodes: [
      { id: "n0", tier: "root", name: "Awakened", kind: "milestone", cost: 0, requires: [] },
      { id: "n1", tier: "t1", name: "Reach", kind: "buff", cost: 1, requires: ["n0"] },
      { id: "n2", tier: "t1", name: "Shape", kind: "freeform", cost: 2, requires: ["n1"] },
    ],
    unlocked: [],
    points: 1,
  });

  ok("the tree is stored", getGiftTree(student).nodes.length === 3);
  ok("nonsense is not", (await setGiftTree(student, { nodes: "no" }), getGiftTree(student).nodes.length === 0));

  await setGiftTree(student, {
    tiers: [{ key: "root", label: "Awakening" }, { key: "t1", label: "" }],
    nodes: [
      { id: "n0", tier: "root", name: "Awakened", kind: "milestone", cost: 0, requires: [] },
      { id: "n1", tier: "t1", name: "Reach", kind: "buff", cost: 1, requires: ["n0"] },
      { id: "n2", tier: "t1", name: "Shape", kind: "freeform", cost: 2, requires: ["n1"] },
    ],
    unlocked: [],
    points: 1,
  });

  ok("a node with unmet requirements is refused",
    (await unlockGiftNode(student, "n1")).why.startsWith("requires"));

  ok("the free root can be taken", (await unlockGiftNode(student, "n0")).ok === true);
  ok("and cost nothing", getGiftTree(student).points === 1);
  ok("taking it twice is refused", (await unlockGiftNode(student, "n0")).why === "already taken");

  ok("the next node can now be afforded", (await unlockGiftNode(student, "n1")).ok === true);
  ok("and the points were spent", getGiftTree(student).points === 0);
  ok("something unaffordable is refused",
    (await unlockGiftNode(student, "n2")).why.includes("costs 2"));
  ok("but a GM can grant it anyway",
    (await unlockGiftNode(student, "n2", { force: true })).ok === true);
  ok("a node that does not exist is refused",
    (await unlockGiftNode(student, "nope")).why === "no such node");

  ok("it composed as the reserved local tree",
    resolveGiftTree(student).sources.some(s => s.id === LOCAL_TREE));
}

console.log("\n[gift] the library, and a trunk two students share");
{
  const wasGM = game.user.isGM;
  game.user.isGM = true;

  const trunk = {
    id: "core", name: "Awakening", nodes: [
      { id: "n0", name: "Awakened", kind: "milestone", cost: 0, requires: [], x: 50, y: 5 },
      { id: "n1", name: "Reach",    kind: "buff",      cost: 1, requires: ["n0"], x: 30, y: 30 },
      { id: "n2", name: "Focus",    kind: "buff",      cost: 1, requires: ["n0"], x: 70, y: 30 },
    ],
  };
  const branch = {
    id: "ember", name: "The Ember Path", nodes: [
      // The edge that makes composition worth having: this branch hangs off a
      // specific node of the trunk, by qualified id.
      { id: "e1", name: "Ember Fist", kind: "buff", cost: 2, requires: ["core:n1"], x: 20, y: 60,
        grants: [{ uuid: "Compendium.pf2e.feats-srd.Item.EMBERFIST", name: "Ember Fist" }] },
      { id: "e2", name: "Wildfire", kind: "capstone", cost: 3, requires: ["e1"], x: 20, y: 85 },
    ],
  };
  await setGiftTrees([trunk, branch]);

  ok("the library holds both trees", getGiftTrees().length === 2);
  ok("a tree can be fetched by id", giftTreeById("ember").name === "The Ember Path");
  ok("node positions are clamped to the board",
    (await saveGiftTree({ id: "ember", name: "The Ember Path", nodes: [
      ...branch.nodes, { id: "e3", name: "Off the edge", x: 480, y: -20 }] }),
     giftTreeById("ember").nodes.find(n => n.id === "e3").x === 100 &&
     giftTreeById("ember").nodes.find(n => n.id === "e3").y === 0));
  await saveGiftTree(branch);

  ok("a colon in a tree id would break namespacing, so it cannot survive",
    (await setGiftTrees([...getGiftTrees(), { id: "a:b", name: "Bad", nodes: [] }]),
     getGiftTrees().some(t => t.id === "a-b")));
  ok("and the local pseudo-tree cannot be shadowed",
    (await setGiftTrees([...getGiftTrees(), { id: LOCAL_TREE, name: "Sneaky", nodes: [] }]),
     !getGiftTrees().some(t => t.id === LOCAL_TREE)));
  await setGiftTrees([trunk, branch]);

  const rin = makeActor("Rin Adler");
  const kade = makeActor("Kade Roan");
  actors.push(rin, kade);

  await assignGiftTrees(rin, ["core", "ember"]);
  await assignGiftTrees(kade, ["core"]);

  const g = resolveGiftTree(rin);
  ok("both trees compose into one graph", g.nodes.length === 5);
  ok("and ids are namespaced by their tree", g.byId.has("core:n1") && g.byId.has("ember:e1"));
  ok("a bare requires stays inside its own tree",
    eq(g.byId.get("ember:e2").requires, ["ember:e1"]));
  ok("a qualified one crosses into the trunk",
    eq(g.byId.get("ember:e1").requires, ["core:n1"]));
  ok("the student on the trunk alone sees only the trunk",
    resolveGiftTree(kade).nodes.length === 3);
  ok("a tree deleted out from under an assignment contributes nothing",
    (await deleteGiftTree("ember"), resolveGiftTree(rin).nodes.length === 3));
  await saveGiftTree(branch);

  // --- states, which the viewer draws from ---
  await grantGiftPoints(rin, 2, "First bell");
  const g2 = resolveGiftTree(rin);
  ok("points landed in the one shared pool", g2.points === 2);
  ok("a free root with no requirements is affordable",
    giftNodeState(g2, g2.byId.get("core:n0")) === "affordable");
  ok("a node behind an untaken prerequisite is locked by requirement",
    giftNodeState(g2, g2.byId.get("ember:e1")) === "locked-req");

  await unlockGiftNode(rin, "core:n0");
  await unlockGiftNode(rin, "core:n1");
  const g3 = resolveGiftTree(rin);
  ok("the branch root unlocks across the tree boundary",
    giftNodeState(g3, g3.byId.get("ember:e1")) === "locked-cost", g3.points + " point(s) left");
  ok("cost and requirement are different states, and it is the cost now",
    g3.points === 1 && g3.byId.get("ember:e1").cost === 2);
  ok("spending is refused when the pool is short",
    (await unlockGiftNode(rin, "ember:e1")).why.includes("costs 2"));

  await grantGiftPoints(rin, 1);
  const res = await unlockGiftNode(rin, "ember:e1");
  ok("and allowed when it is not", res.ok === true);
  ok("the grant became a real item on the actor",
    rin.items.some(i => i.name === "Ember Fist"));
  ok("and its id was recorded, so a refund can take back exactly that one",
    eq(getGiftTree(rin).granted["ember:e1"], [rin.items.find(i => i.name === "Ember Fist").id]));

  ok("a student's progress is untouched by an edit to the shared trunk",
    (await saveGiftTree({ ...trunk, nodes: trunk.nodes.map(n =>
        n.id === "n2" ? { ...n, name: "Focus (revised)" } : n) }),
     resolveGiftTree(rin).byId.get("core:n1").taken === true &&
     resolveGiftTree(rin).byId.get("core:n2").name === "Focus (revised)"));

  game.user.isGM = wasGM;
}

console.log("\n[gift] grants that cannot be found, and taking things back");
{
  const wasGM = game.user.isGM;
  game.user.isGM = true;

  await setGiftTrees([{
    id: "t", name: "Test", nodes: [
      { id: "a", name: "A", cost: 0, requires: [] },
      { id: "b", name: "B", cost: 1, requires: ["a"],
        grants: [{ uuid: "Compendium.pf2e.feats-srd.Item.QUICKSTEP", name: "Quick Step" }] },
      { id: "c", name: "C", cost: 1, requires: ["b"] },
      { id: "d", name: "D", cost: 1, requires: ["a"],
        grants: [{ uuid: "Compendium.pf2e.feats-srd.Item.GONE", name: "Vanished Feat" }] },
    ],
  }]);

  const s = makeActor("Refund Test");
  actors.push(s);
  await assignGiftTrees(s, ["t"]);
  await grantGiftPoints(s, 5);

  await unlockGiftNode(s, "t:a");
  await unlockGiftNode(s, "t:b");
  await unlockGiftNode(s, "t:c");

  const dead = await unlockGiftNode(s, "t:d");
  ok("a grant whose uuid no longer resolves does not block the unlock", dead.ok === true);
  ok("the failure is reported rather than swallowed", dead.failedGrants.length === 1);
  ok("and nothing phantom was added to the actor",
    s.items.filter(i => i.name === "Vanished Feat").length === 0);

  const before = getGiftTree(s).points;
  const prev = await refundGiftNode(s, "t:b", { preview: true });
  ok("a refund preview names the dependents that would go with it",
    eq(prev.nodes.map(n => n.id).sort(), ["t:b", "t:c"]));
  ok("and writes nothing", getGiftTree(s).points === before);

  const done = await refundGiftNode(s, "t:b");
  ok("the refund cascades to the dependent", done.nodes.length === 2);
  ok("every point comes back", getGiftTree(s).points === before + 2);
  ok("the granted item is removed by id", !s.items.some(i => i.name === "Quick Step"));
  ok("the node it depended on is untouched",
    resolveGiftTree(s).byId.get("t:a").taken === true);
  ok("refunding something not taken is refused",
    (await refundGiftNode(s, "t:b")).why === "not taken");

  await unlockGiftNode(s, "t:b");
  const reset = await resetGiftTree(s);
  ok("a reset gives back every point spent", reset.refund === 2);
  ok("and leaves nothing taken", resolveGiftTree(s).nodes.every(n => !n.taken));
  ok("and removes the items those unlocks created",
    !s.items.some(i => i.name === "Quick Step"));
  ok("the dead-grant check finds the node pointing at nothing",
    (await deadGrants("t")).length === 1);

  game.user.isGM = wasGM;
}

console.log("\n[gift] what makes a tree unplayable");
{
  const graphOf = nodes => nodes.map(n => ({
    ...cleanGiftNode(n), id: `t:${n.id}`, localId: n.id, tree: "t",
    requires: (n.requires ?? []).map(r => qualify("t", r)),
  }));

  const cyclic = validateGiftGraph(graphOf([
    { id: "a", name: "A", requires: ["b"] },
    { id: "b", name: "B", requires: ["a"] },
  ]));
  ok("a circular requirement is an error", cyclic.some(p => p.message.startsWith("circular")));
  ok("and so is the pair being unreachable",
    cyclic.filter(p => p.message.includes("no legal path")).length === 2);

  const dangling = validateGiftGraph(graphOf([
    { id: "a", name: "A", requires: [] },
    { id: "b", name: "B", requires: ["ghost"] },
  ]));
  ok("an edge pointing at nothing is an error",
    dangling.some(p => p.message.includes('requires "t:ghost"')));

  const dupes = validateGiftGraph(graphOf([
    { id: "a", name: "A", requires: [] },
    { id: "a", name: "Also A", requires: [] },
  ]));
  ok("a duplicate node id is caught", dupes.some(p => p.message.includes("duplicate")));

  const unnamed = validateGiftGraph(graphOf([{ id: "a", name: "", requires: [] }]));
  ok("a node with no name is a warning, not an error",
    unnamed.length === 1 && unnamed[0].level === "warn");

  const fine = validateGiftGraph(graphOf([
    { id: "a", name: "A", requires: [] },
    { id: "b", name: "B", requires: ["a"] },
  ]));
  ok("a tree that is actually playable reports nothing", fine.length === 0);

  /*
   * A branch validated on its own would report its trunk edge as dangling,
   * which is why validation runs against the whole library and filters back
   * down to the tree being edited.
   */
  const wasGM = game.user.isGM;
  game.user.isGM = true;
  const library = [
    { id: "trunk", name: "Trunk", nodes: [{ id: "n1", name: "Root", cost: 0, requires: [] }] },
    { id: "leaf",  name: "Leaf",  nodes: [{ id: "x", name: "X", cost: 1, requires: ["trunk:n1"] }] },
  ];
  await setGiftTrees(library);

  ok("a branch's edge into the trunk is not a dangling edge",
    validateGiftTree("leaf", library).length === 0);
  ok("but the same branch alone would be unplayable",
    validateGiftGraph(graphOf([{ id: "x", name: "X", requires: ["trunk:n1"] }])).length === 2);
  ok("and the strip only reports the tree being edited",
    validateGiftTree("leaf", [
      ...library,
      { id: "broken", name: "Broken", nodes: [{ id: "q", name: "Q", requires: ["nope"] }] },
    ]).length === 0);

  game.user.isGM = wasGM;
}

console.log("\n[gift] the student's view of their own tree");
{
  const wasGM = game.user.isGM;
  game.user.isGM = true;

  await setGiftTrees([{
    id: "view", name: "Viewer", nodes: [
      { id: "root",  name: "Awakened",  kind: "milestone", cost: 0, requires: [], x: 50, y: 10 },
      { id: "cheap", name: "Reach",     kind: "buff",      cost: 1, requires: ["root"], x: 25, y: 45 },
      { id: "dear",  name: "Wildfire",  kind: "capstone",  cost: 9, requires: ["root"], x: 75, y: 45 },
      { id: "deep",  name: "Deep Cut",  kind: "buff",      cost: 1, requires: ["cheap"], x: 25, y: 80 },
    ],
  }]);

  const stu = makeActor("Tree Reader");
  actors.push(stu);
  stu._flags.academic = { gift: "Emberpath", giftLevel: 1, giftMilestones: [], schedule: [] };
  await assignGiftTrees(stu, ["view"]);
  await grantGiftPoints(stu, 1);
  game.user.isGM = wasGM;

  const c = draw(uiFor(stu), "_app_gift");
  ok("a student on a tree gets the tree, not the milestone track",
    c.querySelectorAll(".zsg-board").length === 1 && c.querySelectorAll(".zsg-track").length === 0);
  ok("every node is drawn", c.querySelectorAll(".zsg-node").length === 4);
  ok("and every edge", c.querySelectorAll(".zsg-edge").length === 3);
  ok("the points they have to spend are on the header",
    textOf(c).includes(">1<") && textOf(c).includes("point to spend"));

  /*
   * The four states are the whole point of the screen: "you cannot afford this
   * yet" and "you have not earned the right to this" must not look the same.
   */
  ok("a free root they have not taken reads as affordable",
    c.querySelectorAll(".zsg-node.s-affordable").length === 1);
  // Everything except the root: nothing below an untaken node is reachable,
  // however cheap it is.
  ok("a node behind an untaken prerequisite is locked by requirement",
    c.querySelectorAll(".zsg-node.s-locked-req").length === 3);
  ok("nothing is taken yet", c.querySelectorAll(".zsg-node.s-taken").length === 0);

  await unlockGiftNode(stu, "view:root");
  const c2 = draw(uiFor(stu), "_app_gift");
  ok("taking the root marks it taken", c2.querySelectorAll(".zsg-node.s-taken").length === 1);
  ok("what it unblocks is now affordable or priced, not requirement-locked",
    c2.querySelectorAll(".zsg-node.s-affordable").length === 1 &&
    c2.querySelectorAll(".zsg-node.s-locked-cost").length === 1);
  ok("the edge between two taken nodes is not lit until both ends are",
    c2.querySelectorAll(".zsg-edge.lit").length === 0);

  await unlockGiftNode(stu, "view:cheap");
  const c3 = draw(uiFor(stu), "_app_gift");
  ok("and is lit once they are", c3.querySelectorAll(".zsg-edge.lit").length === 1);

  // --- the node sheet ---
  const sheet = draw(uiFor(stu, { giftNode: "view:dear" }), "_app_gift");
  ok("opening a node shows its sheet", sheet.querySelectorAll(".zsg-sheet").length === 1);
  ok("an unaffordable node offers no way to take it",
    sheet.querySelectorAll(".zsg-take").length === 0);
  ok("and says what it would cost against what they have",
    textOf(sheet).includes("9 points — you have 0"));

  const broke = draw(uiFor(stu, { giftNode: "view:deep" }), "_app_gift");
  ok("a node they cannot currently pay for offers no button",
    getGiftTree(stu).points === 0 && broke.querySelectorAll(".zsg-take").length === 0);

  await grantGiftPoints(stu, 2);
  const rich = draw(uiFor(stu, { giftNode: "view:deep" }), "_app_gift");
  ok("with points in hand, the same node can be taken from the sheet",
    rich.querySelectorAll(".zsg-take").length === 1);

  // --- where it opens ---
  const v = uiFor(stu);
  const focus = v._giftFocus(resolveGiftTree(stu));
  const affordable = resolveGiftTree(stu).nodes
    .filter(n => !n.taken && giftNodeState(resolveGiftTree(stu), n) === "affordable");
  ok("it frames the frontier, not the root they took six sessions ago",
    Math.abs(focus.x - affordable.reduce((t, n) => t + n.x, 0) / affordable.length) < 0.01);

  // --- the fallback ---
  const plain = makeActor("No Tree");
  actors.push(plain);
  plain._flags.academic = { gift: "Stillwater", giftLevel: 1, schedule: [],
    giftMilestones: [{ name: "First spark", achieved: true }] };
  const fb = draw(uiFor(plain), "_app_gift");
  ok("a student on no tree still gets the v1.8 milestone track",
    fb.querySelectorAll(".zsg-track").length === 1 && fb.querySelectorAll(".zsg-board").length === 0);
}

console.log("\n[gift] lifting a pre-v1.12 tree into the library");
{
  const wasGM = game.user.isGM;
  const wasUsers = game.users;
  game.user.isGM = true;

  const old = makeActor("Legacy Gift");
  actors.push(old);
  await setGiftTree(old, {
    nodes: [
      { id: "n0", name: "Awakened", cost: 0, requires: [] },
      { id: "n1", name: "Reach", cost: 1, requires: ["n0"] },
    ],
    unlocked: ["n0"],
    points: 2,
  });
  game.users = userList([{ id: "u9", isGM: false, character: old }]);
  settings.schemaVersion = 2;
  await setGiftTrees([]);

  const n = await migrateGiftTrees();
  ok("the student's tree moved into the library", n === 1 && getGiftTrees().length === 1);
  ok("under an id of their own, not merged with anyone else's",
    getGiftTrees()[0].id === `gift-${old.id}`);
  ok("they are assigned to it", eq(getGiftTree(old).trees, [`gift-${old.id}`]));
  ok("their progress came with them, namespaced",
    eq(getGiftTree(old).unlocked, [`gift-${old.id}:n0`]));
  ok("and their points are untouched", getGiftTree(old).points === 2);
  ok("the tree is no longer duplicated on the actor", getGiftTree(old).nodes.length === 0);
  ok("what they took still reads as taken",
    resolveGiftTree(old).byId.get(`gift-${old.id}:n0`).taken === true);
  ok("the world is stamped so it never runs twice",
    schemaVersion() === 3 && (await migrateGiftTrees()) === 0);

  game.users = wasUsers;
  game.user.isGM = wasGM;
}

console.log("\n[notes] exporting a notebook");
{
  const wasGM = game.user.isGM;
  const student = game.actors.getName("Note Taker");

  const md = notebookMarkdown(student, "personal");
  ok("the export names the student", md.startsWith("# Note Taker — Notes"), md.slice(0, 40));
  ok("it says when it was made", md.includes("Exported "));
  ok("every note becomes a heading", md.includes("## The Tomb"));
  ok("and its text comes with it", md.includes("The tomb door opens inward."));

  ok("a formatted page is converted rather than dropped",
    htmlToMarkdown("<p>See <strong>this</strong> and <em>that</em></p>") === "See **this** and *that*",
    htmlToMarkdown("<p>See <strong>this</strong> and <em>that</em></p>"));
  ok("headings shift down a level, under the note's own title",
    htmlToMarkdown("<h1>Top</h1>") === "## Top");
  ok("list items become bullets", htmlToMarkdown("<ul><li>one</li><li>two</li></ul>") === "- one\n- two");
  ok("links keep both halves",
    htmlToMarkdown('<a href="x.html">there</a>') === "[there](x.html)");

  game.user.isGM = true;
  await ensurePartyNotebook();
  const both = allNotesMarkdown(student);
  ok("both books can come out together",
    both.includes("# Note Taker — Notes") && both.includes("# Party Notes"));
  ok("with a rule between them", both.includes("\n---\n"));

  // Someone who has never been issued one — provisionNotebooks only reaches
  // actors a user is playing, and nobody is playing this one.
  const stranger = makeActor("No Notebook");
  actors.push(stranger);
  ok("a student with no notebook exports nothing rather than throwing",
    notebookMarkdown(stranger, "personal") === "");

  game.user.isGM = wasGM;
}

console.log("\n[danger] the summary the confirmation dialog reads out");
{
  const sum = scrollDataSummary();
  ok("it counts the actors holding data", sum.actors >= 1);
  ok("it counts messages, contacts, images and alerts",
    sum.messages >= 1 && sum.contacts >= 1 && sum.images >= 1 && sum.notifications >= 0);
}

console.log("\n[danger] clear");
{
  const backup = exportScrollData();
  const before = scrollDataSummary().actors;

  await setAnnouncements([{ text: "Still here after a scroll-only clear" }]);

  const cleared = await clearScrollData();
  ok("it reports how many actors it cleared", cleared === before, `${cleared} of ${before}`);
  ok("every scroll flag is gone from every actor",
    game.actors.every(a => !a.getFlag("zenith-scroll", "social") &&
                           !a.getFlag("zenith-scroll", "profile") &&
                           !a.getFlag("zenith-scroll", "system")));
  ok("flags are unset, not left as empty shells",
    game.actors.every(a => a._flags.social === undefined));
  ok("loadSection still returns clean defaults afterwards",
    loadSection(me, "social").conversations.length === 0);

  ok("the notice board survives a scroll-only clear, as documented",
    getAnnouncements().length === 1);

  await clearScrollData({ includeWorld: true });
  ok("and is cleared when the checkbox is ticked", getAnnouncements().length === 0);

  ok("a second clear finds nothing left to do", await clearScrollData() === 0);
  ok("the backup still holds what was removed",
    backup.actors.some(a => a.name === "Rin Adler" && a.flags.social?.conversations?.length));
}

console.log("\n" + "=".repeat(52));
console.log(fails === 0 ? `ALL ${passes} CHECKS PASSED` : `${passes} passed, ${fails} FAILED`);
process.exit(fails ? 1 : 0);
