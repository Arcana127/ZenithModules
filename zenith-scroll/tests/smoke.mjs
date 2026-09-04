/**
 * Zenith Academy Scroll — smoke test
 *
 *   node tests/smoke.mjs
 *
 * Stubs just enough of Foundry and the DOM to import the real modules and
 * exercise the logic that isn't purely visual. Nothing here talks to a browser,
 * so the boot animation, drag handling and dialog chrome still need a look in
 * the actual app.
 */

let fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log("  PASS  " + name); }
  else { fails++; console.log("  FAIL  " + name + (extra ? "\n          " + extra : "")); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------- fake DOM
function makeEl(tag) {
  const n = {
    tagName: tag, className: "", _text: "", innerHTML: "", children: [],
    dataset: {}, style: { setProperty() {} }, scrollTop: 0, scrollHeight: 0, attrs: {},
    appendChild(c) { this.children.push(c); return c; },
    append(...cs) { for (const c of cs) this.children.push(c); },
    replaceChildren(...cs) { this.children = cs; },
    addEventListener() {}, removeEventListener() {}, remove() {},
    setAttribute(k, v) { this.attrs[k] = v; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, contains() { return false; } },
    getBoundingClientRect() { return { left: 0, top: 0 }; },
    get firstElementChild() { return this.children[0] ?? null; },
  };
  Object.defineProperty(n, "textContent", { get() { return this._text; }, set(v) { this._text = v; } });
  return n;
}
globalThis.document = { createElement: makeEl, getElementById: () => null, body: makeEl("body") };
globalThis.window = {};

// ------------------------------------------------------------ fake Foundry
const hooks = [];
globalThis.Hooks = { once: (h, f) => hooks.push([h, f]), on: (h, f) => hooks.push([h, f]) };
globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
globalThis.foundry = { applications: { api: {} } };
globalThis.canvas = { tokens: { controlled: [] } };

const updates = [];                     // every actor.update(), for assertions
function makeActor(name, flags = {}) {
  return {
    id: "actor-" + name.toLowerCase().replace(/\W/g, ""), name,
    img: "portrait/" + name + ".webp", isOwner: true, items: [], _flags: flags,
    getFlag(_m, k) { return this._flags[k]; },
    async update(data, opts) {
      updates.push({ actor: this.name, data, opts });
      Object.assign(this._flags, data.flags["zenith-scroll"]);
    },
    testUserPermission() { return true; },
  };
}

/** game.users is a Foundry Collection, not a bare array - it needs .get(). */
function userList(arr) {
  return Object.assign(arr, { get: id => arr.find(u => u.id === id) });
}

let settings = { enablePlayerMessaging: true, galleryFolder: "scroll-gallery" };
let settingsThrow = false;
const actors = [];
globalThis.game = {
  actors: Object.assign(actors, {
    get: id => actors.find(a => a.id === id),
    getName: n => actors.find(a => a.name === n),
  }),
  users: userList([]),
  user: { isGM: false, id: "u1", character: null, getFlag: () => null, setFlag: () => {} },
  settings: {
    register() {},
    get(_m, k) { if (settingsThrow) throw new Error("not registered"); return settings[k]; },
  },
  time: { worldTime: 0 }, modules: { get: () => null }, socket: { on() {}, emit() {} },
};

// ------------------------------------------------- import the real modules
// The entry is imported for its side effect of registering hooks.
await import("../scripts/zenith-scroll.mjs");
const { esc, relInfo, app } = await import("../scripts/core.mjs");
const { loadSection, saveSection, totalUnread } = await import("../scripts/data.mjs");
const { msgEnabled, gmOnline } = await import("../scripts/socket.mjs");
const { ScrollUI } = await import("../scripts/ui-scroll.mjs");

// =========================================================================
console.log("\n[core] HTML escaping");
ok("escapes all five entities", esc(`<img src=x onerror="a">&'`) === "&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;");
ok("null/undefined -> empty string", esc(null) === "" && esc(undefined) === "");
ok("passes plain text through", esc("Ilya Vance") === "Ilya Vance");

console.log("\n[core] relationship scale");
ok("maps a rank to its label", relInfo(4).label === "Trusted");
ok("unknown rank falls back to Neutral", relInfo(99).label === "Neutral");

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

console.log("\n[data] totalUnread");
const a3 = makeActor("Test Three", { social: { conversations: [
  { id: "c1", messages: [{ read: false, sent: false }, { read: true, sent: false }, { read: false, sent: true }] },
  { id: "c2" },                                       // malformed: no messages array
  { id: "c3", messages: [{ read: false, sent: false }] },
] } });
ok("counts only unread inbound, survives missing arrays", totalUnread(a3) === 2, "got " + totalUnread(a3));

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

const view = new ScrollUI();
view.actor = me;
const ct = makeEl("div");
view._messages(ct, loadSection(me, "social"));

const rows = ct.children.filter(c => c.className === "zsm-thread");
const rowHtml = r => r.children.find(x => x.className === "zsm-tinfo")?.innerHTML ?? "";
const order = rows.map(r => rowHtml(r).match(/zsm-tname">([^<]*)/)?.[1] ?? "?");
ok("sorts by last message ts, not creation order", order[0] === "Prof. Hale" && order[1] === "Ilya Vance",
  "got " + JSON.stringify(order));
ok("empty conversations are still listed", rows.length === 3, "rendered " + rows.length + " rows");
ok("empty thread shows a placeholder preview", rows.some(r => rowHtml(r).includes("No messages yet")));

console.log("\n[ui] escaping through a message preview");
me._flags.social.conversations = [{
  id: "c-xss", participants: ["Rin Adler", "Ilya Vance"], isGroup: false,
  messages: [{ from: "Ilya Vance", text: "<img src=x onerror=alert(1)>", time: "1:00 PM", ts: 9, read: true, sent: false }],
}];
const ct2 = makeEl("div");
view._messages(ct2, loadSection(me, "social"));
const html2 = ct2.children.filter(c => c.className === "zsm-thread").map(rowHtml).join("");
ok("message text is escaped in the thread list", !html2.includes("<img src=x") && html2.includes("&lt;img"));

console.log("\n[ui] New Conversation button honours the setting");
const btnCount = d => {
  const c = makeEl("div");
  view.convId = null;
  view._messages(c, d);
  return c.children.filter(x => x.className === "zsm-pm-btn").length;
};
settings.enablePlayerMessaging = true;
ok("shown when messaging is on", btnCount(loadSection(me, "social")) === 1);
settings.enablePlayerMessaging = false;
ok("hidden when messaging is off", btnCount(loadSection(me, "social")) === 0);
settings.enablePlayerMessaging = true;

console.log("\n[ui] contact detail survives a re-render");
me._flags.social.relationships = [{ name: "Prof. Hale", title: "Instructor", rank: 2, category: "Faculty", notes: "wary of me" }];
const relView = new ScrollUI();
relView.actor = me;
relView.relContact = "Prof. Hale";
const ct3 = makeEl("div");
relView._relationships(ct3, loadSection(me, "social"));
const isDetail = ct3.children.some(c => c.className === "zsr-vn-detail");
ok("re-render with relContact set lands on the detail panel, not the grid", isDetail);
relView.relContact = "Someone Who Left";
const ct4 = makeEl("div");
relView._relationships(ct4, loadSection(me, "social"));
ok("a contact that no longer exists falls back to the grid",
  relView.relContact === null && ct4.innerHTML.includes("Contacts"));

// =========================================================================
console.log("\n[ui] home tab: announcement dismissal keys");
const home = new ScrollUI();
home.actor = me;
const renderHome = d => { const c = makeEl("div"); home._home(c, d, 0); return c.innerHTML; };

let d1 = { announcements: [{ id: "ann_a", text: "Assembly" }, { id: "ann_b", text: "Exam" }],
           dismissedAnnouncements: ["ann_b"], schedule: [], gallery: [] };
ok("id-keyed dismissal hides the right one",
  renderHome(d1).includes("Assembly") && !renderHome(d1).includes("Exam"));
d1.announcements.reverse();
ok("still correct after the list is reordered",
  renderHome(d1).includes("Assembly") && !renderHome(d1).includes("Exam"));

const h2 = renderHome({ announcements: [{ text: "Old A" }, { text: "Old B" }],
                        dismissedAnnouncements: [1], schedule: [], gallery: [] });
ok("pre-v1.6 numeric dismissals still honoured", h2.includes("Old A") && !h2.includes("Old B"));

console.log("\n[ui] home tab: escaping");
const h3 = renderHome({ announcements: [{ id: "x", text: "<script>bad()</script>" }],
                        status: "<img src=x onerror=alert(1)>", dismissedAnnouncements: [],
                        schedule: [], gallery: [] });
ok("status is escaped", !h3.includes("<img src=x") && h3.includes("&lt;img"));
ok("announcement text is escaped", !h3.includes("<script>") && h3.includes("&lt;script&gt;"));

// =========================================================================
console.log("\n[hooks] registration");
const names = hooks.map(h => h[0]);
ok("registers the v13+ context hook", names.includes("getActorContextOptions"));
ok("no longer registers the dead v12 hook", !names.includes("getActorDirectoryEntryContext"));
ok("updateActor hook present", names.includes("updateActor"));
ok("updateActor takes (doc, changed, options, userId)",
  hooks.find(h => h[0] === "updateActor")[1].length === 4);
ok("init and ready are registered", names.includes("init") && names.includes("ready"));

console.log("\n[wiring] singleton registry");
ok("app registry exists with the three slots",
  app && "icon" in app && "ui" in app && "gm" in app);

// =========================================================================
// Every render path, executed. A split turns a missing import into a runtime
// ReferenceError that `node --check` cannot see, so the point here is simply
// that each path runs to completion.
console.log("\n[coverage] every player tab renders");
const { GMPanel } = await import("../scripts/ui-gm.mjs");
const { ZenithAPI } = await import("../scripts/api.mjs");
const { initSocket } = await import("../scripts/socket.mjs");

me._flags.academic = {
  schedule: [{ period: "First Bell", course: "Rites", instructor: "Hale", location: "Hall" }],
  gift: "Emberwake", giftDescription: "<em>burns</em>", giftLevel: 3,
  giftMilestones: [{ name: "First Spark", achieved: true }, { name: "Second", achieved: false }],
  nextEvent: "Second Examination", nextEventDays: 2, notes: "<b>ok</b>",
};
me._flags.media = { gallery: [{ src: "a.webp", caption: "Field trip" }] };
me._flags.system = { announcements: [{ id: "a1", text: "Assembly" }], dismissedAnnouncements: [] };

for (const tab of ["home", "schedule", "gift", "messages", "relationships", "gallery"]) {
  let threw = null;
  try {
    const v = new ScrollUI();
    v.actor = me;
    v.tab = tab;
    v.render();
  } catch (e) { threw = e; }
  ok("ScrollUI renders the " + tab + " tab", !threw, threw && (threw.constructor.name + ": " + threw.message));
}

console.log("\n[coverage] every GM Command Center section renders");
game.user.isGM = true;
const gm = new GMPanel();
gm.actor = me;
for (const section of ["info", "schedule", "gift", "messages",
                       "relationships", "gallery", "announce", "event"]) {
  let threw = null;
  try { gm.section = section; gm.render(); } catch (e) { threw = e; }
  ok("GMPanel renders " + section, !threw, threw && (threw.constructor.name + ": " + threw.message));
}

console.log("\n[coverage] macro API");
for (const [label, fn] of [
  ["sendNPCMessage", () => ZenithAPI.sendNPCMessage("Rin Adler", "Prof. Hale", "Report to my office.")],
  ["adjustRelationship", () => ZenithAPI.adjustRelationship("Rin Adler", "Prof. Hale", 1, "Covered for her")],
  ["addGalleryImage", () => ZenithAPI.addGalleryImage("Rin Adler", "b.webp", "Second")],
  ["setEvent", () => ZenithAPI.setEvent("Rin Adler", "Third Examination", 5)],
]) {
  let threw = null;
  try { await fn(); } catch (e) { threw = e; }
  ok("ZenithAPI." + label + " runs", !threw, threw && (threw.constructor.name + ": " + threw.message));
}
ok("adjustRelationship moved the rank and logged history", (() => {
  const r = loadSection(me, "social").relationships.find(x => x.name === "Prof. Hale");
  return r && r.rank === 3 && r.history.some(h => h.includes("Covered for her"));
})());

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

console.log("\n" + "=".repeat(52));
console.log(fails === 0 ? `ALL ${passes} CHECKS PASSED` : `${passes} passed, ${fails} FAILED`);
process.exit(fails ? 1 : 0);
