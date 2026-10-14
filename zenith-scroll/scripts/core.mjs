/**
 * Zenith Academy Scroll — core
 *
 * Module constants and the dependency-free helpers everything else builds on.
 * This file imports nothing, which is what keeps the rest of the module free of
 * circular imports.
 */

// ---------------------------------------------------------------------------
//  Identity
// ---------------------------------------------------------------------------

/** Module id. Also the flag scope on every actor. */
export const M = "zenith-scroll";

/** User-flag key holding the dragged position of the scroll icon. */
export const FP = "iconPosition";

/**
 * Flag sub-keys. Data is split across these rather than living in one flat
 * object, so saving one area can never clobber another.
 *
 * `prefs` is its own key rather than living inside `system` on purpose: the GM
 * relay writes `system.notifications` on a player's behalf while the player
 * writes their own prefs, and sharing a key would let one clobber the other.
 */
export const F = {
  profile: "profile",    // studentId, year, cohort, dormitory, status, statusPreset
  academic: "academic",  // schedule, gift, giftDescription, giftLevel, giftMilestones,
                         // nextEvent, nextEventDays, notes
  social: "social",      // conversations, relationships
  media: "media",        // gallery
  system: "system",      // dismissedAnnouncements, notifications, (legacy announcements)
  prefs: "prefs",        // deviceName, accent, reduceMotion, lastSeenNotif
};

/**
 * Live singletons, assigned once during the `ready` hook.
 *
 * These live here rather than in the UI files so that lower layers (the socket
 * relay, the macro API) can nudge the interface without importing it, which
 * would create an import cycle.
 */
export const app = {
  icon: null,   // ScrollIcon
  ui: null,     // ScrollUI
  gm: null,     // GMPanel
};

// ---------------------------------------------------------------------------
//  App registry  —  what the home screen grid shows
// ---------------------------------------------------------------------------

/**
 * The apps on the device, in grid order.
 *
 * `dock: true` also pins the app to the bottom bar. Adding an app here is all
 * it takes to put it on the home screen; ScrollUI looks for a matching
 * `_app_<id>` method to render it. This replaced the hardcoded six-entry TABS
 * list, which had no room for a seventh.
 *
 * v1.8 added Alerts and Bank. Alerts is the notification centre, which used to
 * be an overlay hung off the status bar; with the bar gone it is an app like
 * anything else, which also gets it a badge for free.
 */
export const APPS = [
  { id: "profile",  label: "Student ID", icon: "fa-id-badge",      dock: false },
  { id: "messages", label: "Messages",   icon: "fa-comment-dots",  dock: true  },
  { id: "contacts", label: "Contacts",   icon: "fa-heart",         dock: true  },
  { id: "notices",  label: "Notices",    icon: "fa-bullhorn",      dock: true  },
  { id: "schedule", label: "Schedule",   icon: "fa-calendar-days", dock: false },
  { id: "notes",    label: "Notes",      icon: "fa-book",          dock: false },
  { id: "map",      label: "Maps",       icon: "fa-map-location-dot", dock: false },
  { id: "gift",     label: "Gift",       icon: "fa-wand-sparkles", dock: false },
  { id: "bank",     label: "Bank",       icon: "fa-coins",         dock: false },
  { id: "gallery",  label: "Gallery",    icon: "fa-images",        dock: false },
  { id: "camera",   label: "Camera",     icon: "fa-camera",        dock: false },
  { id: "alerts",   label: "Alerts",     icon: "fa-bell",          dock: false },
  { id: "settings", label: "Settings",   icon: "fa-sliders",       dock: false },
];

/** Look up an app's metadata by id. */
export function appInfo(id) {
  return APPS.find(a => a.id === id) ?? null;
}

// ---------------------------------------------------------------------------
//  Personalisation
// ---------------------------------------------------------------------------

/**
 * Selectable accent colours. The projection tints its glow, hairlines and
 * highlights from whichever one the student picks, so two scrolls open side by
 * side on the table read as different devices.
 */
export const ACCENTS = [
  { id: "aether",   label: "Aether",   hue: "#50d8e8", deep: "#1c7f8e", bright: "#a6f2fb" },
  { id: "verdant",  label: "Verdant",  hue: "#4fd995", deep: "#1d7d55", bright: "#a8f5d0" },
  { id: "ember",    label: "Ember",    hue: "#ff9a5c", deep: "#9c4a1e", bright: "#ffd0b0" },
  { id: "amethyst", label: "Amethyst", hue: "#b98cf5", deep: "#5b3a94", bright: "#e0ccff" },
  { id: "rose",     label: "Rose",     hue: "#f682a8", deep: "#93365a", bright: "#ffc8da" },
  { id: "gold",     label: "Gold",     hue: "#e6c258", deep: "#8e6a12", bright: "#ffeaa8" },
];

/** Resolve an accent id to its swatch; unknown ids fall back to Aether. */
export function accentInfo(id) {
  return ACCENTS.find(a => a.id === id) ?? ACCENTS[0];
}

// ---------------------------------------------------------------------------
//  Currency
// ---------------------------------------------------------------------------

/**
 * The currencies the Bank app shows, in display order.
 *
 * Both Astras and Marks are ordinary inventory items whose amount lives in
 * `system.quantity`, so a currency is just an item name plus how to draw it.
 * The world setting `currencies` overrides this list; this is the shape it has
 * to match, and the fallback when the setting is missing or malformed.
 *
 * `primary` decides which balance the Student ID card shows in its stat row —
 * there is only room for one there.
 */
export const DEFAULT_CURRENCIES = [
  { key: "marks",  itemName: "marks",  label: "Marks",  icon: "fa-coins",  tint: "#e0c050", primary: true  },
  { key: "astras", itemName: "astras", label: "Astras", icon: "fa-star",   tint: "#a6f2fb", primary: false },
];

/**
 * The configured currency list, defended against a malformed setting.
 *
 * A GM editing this by hand in the settings JSON is the likeliest way it breaks,
 * and a currency list that throws would take the whole home screen down with it.
 */
export function currencyList() {
  let raw = null;
  try { raw = game.settings.get(M, "currencies"); } catch (e) { /* unregistered */ }
  if (!Array.isArray(raw) || !raw.length) return DEFAULT_CURRENCIES.map(c => ({ ...c }));

  const clean = raw
    .filter(c => c && (c.key || c.itemName))
    .map((c, i) => ({
      key: String(c.key ?? c.itemName ?? `cur${i}`),
      itemName: String(c.itemName ?? c.key ?? ""),
      label: String(c.label ?? c.key ?? "Currency"),
      icon: String(c.icon ?? "fa-coins"),
      tint: String(c.tint ?? "#e0c050"),
      primary: !!c.primary,
    }));
  if (!clean.length) return DEFAULT_CURRENCIES.map(c => ({ ...c }));
  if (!clean.some(c => c.primary)) clean[0].primary = true;
  return clean;
}

/** One currency by key, or null. */
export function currencyInfo(key) {
  return currencyList().find(c => c.key === key) ?? null;
}

/** The currency shown on the Student ID card. */
export function primaryCurrency() {
  const list = currencyList();
  return list.find(c => c.primary) ?? list[0];
}

// ---------------------------------------------------------------------------
//  Relationship scale
// ---------------------------------------------------------------------------

/** -5..+5, matching the gradient bar in the relationship detail panel. */
export const REL_SCALE = [
  { val: -5, label: "Nemesis",  color: "#a02020" },
  { val: -4, label: "Hated",    color: "#c03030" },
  { val: -3, label: "Hostile",  color: "#d05040" },
  { val: -2, label: "Cold",     color: "#b07060" },
  { val: -1, label: "Wary",     color: "#908070" },
  { val:  0, label: "Neutral",  color: "#808080" },
  { val:  1, label: "Cordial",  color: "#6a8870" },
  { val:  2, label: "Friendly", color: "#509050" },
  { val:  3, label: "Close",    color: "#40a060" },
  { val:  4, label: "Trusted",  color: "#c0a030" },
  { val:  5, label: "Devoted",  color: "#d4940a" },
];

/** Look up a rank's label and colour; unknown ranks fall back to Neutral. */
export function relInfo(r) {
  return REL_SCALE.find(x => x.val === r) ?? REL_SCALE[5];
}

// ---------------------------------------------------------------------------
//  Device artwork
// ---------------------------------------------------------------------------

/**
 * The bracelet, drawn as inline SVG so the module still ships no image assets.
 *
 * It replaced a CSS clip-path slab in v1.7. SVG rather than more clip-paths
 * because the band is an ellipse seen at an angle, and polygon() cannot make
 * that curve cleanly at 64px.
 *
 * Gradient ids are namespaced `zsb-` because this markup is injected into the
 * document body, where a generic id would collide with Foundry's own SVG defs.
 * The stone reads its colours from the accent custom properties, so it changes
 * with the student's chosen accent.
 */
export const BRACELET_SVG = `
<svg class="zsi-svg" viewBox="0 0 64 64" width="64" height="64" aria-hidden="true" focusable="false">
  <defs>
    <!-- Horizontal ramp: the cuff is a cylinder, so it is lit across, not down. -->
    <linearGradient id="zsb-wall" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#243545"/>
      <stop offset="15%"  stop-color="#5d7286"/>
      <stop offset="37%"  stop-color="#b7c8d5"/>
      <stop offset="51%"  stop-color="#8a9cab"/>
      <stop offset="73%"  stop-color="#526677"/>
      <stop offset="100%" stop-color="#1f2f40"/>
    </linearGradient>
    <linearGradient id="zsb-shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#ffffff" stop-opacity=".26"/>
      <stop offset="42%"  stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity=".5"/>
    </linearGradient>
    <linearGradient id="zsb-inner" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#050c11"/>
      <stop offset="100%" stop-color="#15242d"/>
    </linearGradient>
    <linearGradient id="zsb-gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="#e8c86a"/>
      <stop offset="45%"  stop-color="#c8a030"/>
      <stop offset="100%" stop-color="#8d6716"/>
    </linearGradient>
    <radialGradient id="zsb-stone" cx="36%" cy="30%" r="72%">
      <stop offset="0%"   stop-color="var(--zd-accent-bright)"/>
      <stop offset="52%"  stop-color="var(--zd-accent)"/>
      <stop offset="100%" stop-color="var(--zd-accent-deep)"/>
    </radialGradient>
  </defs>

  <!--
    A cuff, not a ring: the outer wall is the front half of a cylinder, capped
    by the opening you slip your wrist through. Top and bottom rims are the same
    ellipse 17 units apart, and the wall is the surface between their front arcs.
    The band is deliberately thick — a thin hoop reads as a bowl at 64px.
  -->
  <path class="zsi-wall"
        d="M9,20 A23,8.5 0 0 0 55,20 L55,37 A23,8.5 0 0 1 9,37 Z"
        fill="url(#zsb-wall)"/>
  <path d="M9,20 A23,8.5 0 0 0 55,20 L55,37 A23,8.5 0 0 1 9,37 Z"
        fill="url(#zsb-shade)"/>

  <!-- gold rails along both edges of the cuff -->
  <path d="M9,20 A23,8.5 0 0 0 55,20" fill="none"
        stroke="url(#zsb-gold)" stroke-width="1.4" opacity=".9"/>
  <path d="M9,37 A23,8.5 0 0 0 55,37" fill="none"
        stroke="url(#zsb-gold)" stroke-width="1.4" opacity=".75"/>

  <!-- the opening, drawn over the wall so the band reads as hollow -->
  <ellipse cx="32" cy="20" rx="23" ry="8.5" fill="url(#zsb-inner)"/>
  <ellipse cx="32" cy="20" rx="23" ry="8.5" fill="none"
           stroke="#8397a6" stroke-width="1.3"/>
  <ellipse cx="32" cy="20" rx="23" ry="8.5" fill="none"
           stroke="url(#zsb-gold)" stroke-width=".6" opacity=".55"/>

  <!-- inlaid chips out toward the ends of the band -->
  <circle class="zsi-chip" cx="14" cy="33.5" r="1.8"/>
  <circle class="zsi-chip" cx="50" cy="33.5" r="1.8"/>

  <!-- the focus stone: a cabochon in a raised setting, breaking the top rail -->
  <ellipse class="zsi-stone-halo"  cx="32" cy="35" rx="15"   ry="14"  fill="var(--zd-accent)" opacity=".18"/>
  <ellipse class="zsi-stone-bezel" cx="32" cy="35" rx="11.3" ry="10.5" fill="url(#zsb-gold)"/>
  <ellipse cx="32" cy="35" rx="10.2" ry="9.4" fill="#0a1620" opacity=".85"/>
  <ellipse class="zsi-stone"       cx="32" cy="35" rx="9.5"  ry="8.8" fill="url(#zsb-stone)"/>
  <ellipse class="zsi-stone-spec"  cx="28.6" cy="31.4" rx="3.2" ry="2" fill="#ffffff" opacity=".5"/>
</svg>`;

/** Decorative corner flourish, drawn inline so the module ships no image assets. */
export const CORNER_SVG =
  `<svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true" focusable="false">` +
  `<path d="M2,2 L12,2 L12,4 L4,4 L4,12 L2,12 Z" fill="#c8a030" opacity="0.7"/>` +
  `<circle cx="3" cy="3" r="2" fill="#1a8050" opacity="0.9"/></svg>`;

// ---------------------------------------------------------------------------
//  DOM helpers
// ---------------------------------------------------------------------------

/**
 * Build an element.
 *
 * Attribute keys are special-cased: `class`, `html` (innerHTML), `text`
 * (textContent), `style` (object, assigned onto el.style), and any `onEvent`
 * key whose value is a function becomes an event listener. Everything else is
 * set with setAttribute.
 *
 * @param {string} tag
 * @param {object} at    attributes, as described above
 * @param {Array}  ch    child nodes, or strings to append as text
 * @returns {HTMLElement}
 */
export function el(tag, at = {}, ch = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(at)) {
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k === "text") e.textContent = v;
    else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of ch) {
    if (typeof c === "string") e.append(c);
    else if (c) e.appendChild(c);
  }
  return e;
}

/**
 * A button that is actually a button.
 *
 * Nearly everything clickable in the device used to be a `<div>` with a click
 * handler, which is why the interface was unreachable by keyboard and opaque to
 * a screen reader. This gives it a real role, a real accessible name, and
 * Enter/Space activation for free.
 */
export function btn(cls, label, onClick, at = {}) {
  return el("button", {
    class: cls, type: "button", "aria-label": label, title: label,
    onclick: onClick, ...at,
  });
}

// ---------------------------------------------------------------------------
//  Escaping
// ---------------------------------------------------------------------------

const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/**
 * Escape a value for interpolation into innerHTML.
 *
 * Everything player- or NPC-authored must go through this. The two deliberate
 * exceptions are `academic.notes` and `academic.giftDescription`, both GM-only
 * long-form fields where HTML is intentional.
 */
export function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ESC_MAP[c]);
}

// ---------------------------------------------------------------------------
//  Id generation
// ---------------------------------------------------------------------------

/** Student ID, e.g. "ZA-K7M2PQR". Ambiguous characters (0/O, 1/I) are omitted. */
export function genId() {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 7; i++) s += c[Math.floor(Math.random() * c.length)];
  return "ZA-" + s;
}

/** Prefixed random id — the shape every generated id in the module uses. */
export function uid(prefix) {
  return prefix + "_" + Math.random().toString(36).slice(2, 10);
}

/** Conversation id. Every participant in a thread must share one of these. */
export function convId() { return uid("conv"); }

/**
 * Announcement id. Dismissals key off this rather than the array position, so
 * editing the announcement list doesn't shift everyone's dismissals onto the
 * wrong rows.
 */
export function annId() { return uid("ann"); }

/** Notification-log entry id. */
export function notifId() { return uid("ntf"); }

/** Calendar event id. */
export function evtId() { return uid("evt"); }

// ---------------------------------------------------------------------------
//  Formatting
// ---------------------------------------------------------------------------

export function yearLabel(y) {
  return { 1: "First Year", 2: "Second Year", 3: "Third Year", 4: "Fourth Year" }[y]
    ?? `Year ${y}`;
}

/** "3 days" / "TOMORROW" / "TODAY" / "PASSED", for an event countdown. */
export function daysLabel(n) {
  const d = Number(n);
  if (!Number.isFinite(d)) return "";
  if (d < 0) return "PASSED";
  if (d === 0) return "TODAY";
  if (d === 1) return "TOMORROW";
  return `${d} days`;
}

/**
 * Display timestamp for a message.
 *
 * Prefers SimpleCalendar if it's installed, otherwise formats the world clock as
 * a 12-hour time. Returns "" when there's no usable time, and callers decide
 * what to show instead.
 *
 * This is the *display* string only. Sorting uses the separate numeric `ts`
 * field on each message, so the GM can backdate a message for narrative reasons
 * without it jumping around in the thread list.
 */
export function getAutoTime() {
  try {
    if (window.SimpleCalendar?.api) {
      const dt = SimpleCalendar.api.currentDateTimeDisplay();
      if (dt?.time) return dt.time;
    }
  } catch (e) { /* SimpleCalendar present but unhappy; fall through to world time */ }

  const wt = game.time.worldTime;
  if (wt > 0) {
    const total = wt % 86400;
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
  }
  return "";
}

/**
 * In-world date for the lock screen.
 *
 * SimpleCalendar first, as with the clock. Without it there is no in-world
 * calendar to read, so this returns "" and the lock screen omits the line —
 * showing the player's real-world date would break the fiction harder than
 * showing nothing at all.
 */
export function getAutoDate() {
  try {
    if (window.SimpleCalendar?.api) {
      const dt = SimpleCalendar.api.currentDateTimeDisplay();
      if (dt?.date) return dt.date;
      if (dt?.day && dt?.monthName) return `${dt.monthName} ${dt.day}`;
    }
  } catch (e) { /* fall through */ }
  return "";
}

/**
 * Clock for the status bar and lock screen.
 *
 * Falls back to the real wall clock when the world clock sits at zero, because
 * a status bar reading "--:--" every session looks broken, whereas a plausible
 * time just reads as the device working.
 */
export function getClock() {
  const t = getAutoTime();
  if (t) return t;
  const d = new Date();
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

/** "now" / "2m" / "4h" / "3d" — compact age, for the notification centre. */
export function relTime(ts) {
  const n = Number(ts);
  if (!n) return "";
  const s = Math.max(0, Math.floor((Date.now() - n) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h";
  return Math.floor(s / 86400) + "d";
}


/**
 * An image path that is safe to put in an `src` attribute.
 *
 * Anything arriving over the socket or out of another user's flags goes through
 * here first. Ordinary Foundry paths (`scroll-gallery/duel.webp`) and http(s)
 * URLs pass; `javascript:` is the attack this exists to stop, and `data:` is
 * refused separately — not because it is dangerous but because it would be
 * megabytes of base64 written into someone's actor flags.
 *
 * Returns "" for anything it will not vouch for, which every caller treats as
 * "there is no image here".
 */
export function safeImageSrc(src) {
  const s = String(src ?? "").trim();
  if (!s) return "";
  if (s.includes("..")) return "";                       // no climbing out of the data dir
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return "";         // any other scheme, including data: and javascript:
  if (s.startsWith("//")) return "";                     // protocol-relative, i.e. a scheme in disguise
  return s;
}

// ---------------------------------------------------------------------------
//  Motion
// ---------------------------------------------------------------------------

/**
 * Whether animation should be suppressed.
 *
 * Honours the OS setting first, then the per-student toggle in the device's own
 * Settings app. Callers check this rather than relying on the CSS media query
 * alone, because an animation that is merely instant still fires `animationend`
 * — and the unfurl sequences off exactly that.
 */
export function reducedMotion(prefs) {
  if (prefs?.reduceMotion) return true;
  try { return !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches; }
  catch (e) { return false; }
}

// ---------------------------------------------------------------------------
//  Passphrase hashing  —  the Danger Zone misclick guard
// ---------------------------------------------------------------------------

/**
 * Random salt for a stored passphrase hash.
 *
 * `crypto.getRandomValues` is available in every context, secure or not — it is
 * only `crypto.subtle` that is gated. Math.random is the last resort and, like
 * everything else here, is fine: this guards against a misclick, not an attacker.
 */
export function makeSalt() {
  try {
    const b = new Uint8Array(12);
    crypto.getRandomValues(b);
    return [...b].map(x => x.toString(16).padStart(2, "0")).join("");
  } catch (e) {
    return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }
}

/** Non-cryptographic 128-bit-ish digest, for when `crypto.subtle` is absent. */
function weakHash(str) {
  let h1 = 0x9e3779b9, h2 = 0x85ebca6b, h3 = 0xc2b2ae35, h4 = 0x27d4eb2f;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 + c, 1597334677) ^ (h1 >>> 7);
    h3 = Math.imul(h3 ^ (c + i), 2246822519) ^ (h2 >>> 11);
    h4 = Math.imul(h4 + (c * (i + 1)), 3266489917) ^ (h3 >>> 5);
  }
  return [h1, h2, h3, h4].map(h => (h >>> 0).toString(16).padStart(8, "0")).join("");
}

/**
 * Hash a passphrase with its salt.
 *
 * SHA-256 where it is available. `crypto.subtle` is exposed only in a secure
 * context — HTTPS, localhost or file:// — and plenty of Foundry tables run over
 * plain HTTP on a LAN address, where it is simply `undefined`. There, the pure-JS
 * fallback takes over.
 *
 * That fallback is not cryptographic, and it does not need to be. As the plan
 * for this feature says in as many words: a passphrase here is a misclick guard,
 * not security. Anyone with GM rights and a browser console can bypass the whole
 * dialog, and what actually stops a player wiping the campaign is Foundry's
 * permission model, not this. A weak hash guards against a 1am misclick exactly
 * as well as a strong one.
 *
 * The returned string carries its own algorithm tag so a world that later moves
 * to HTTPS can still verify a passphrase set over HTTP.
 */
export async function hashPassphrase(pass, salt) {
  const input = `${salt}::${String(pass ?? "")}`;
  try {
    if (globalThis.crypto?.subtle?.digest) {
      const bytes = new TextEncoder().encode(input);
      const buf = await crypto.subtle.digest("SHA-256", bytes);
      const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
      return "sha256:" + hex;
    }
  } catch (e) { /* insecure context, or a browser that disagrees; fall through */ }
  return "weak:" + weakHash(input);
}

/**
 * Does this passphrase match the stored record?
 *
 * Verifies against whichever algorithm the record was written with, so moving
 * the world between HTTP and HTTPS does not lock the GM out of their own
 * Danger Zone.
 */
export async function verifyPassphrase(pass, record) {
  if (!record?.hash || !record?.salt) return false;
  const algo = String(record.hash).split(":")[0];
  const input = `${record.salt}::${String(pass ?? "")}`;
  if (algo === "weak") return ("weak:" + weakHash(input)) === record.hash;
  return (await hashPassphrase(pass, record.salt)) === record.hash;
}

// ---------------------------------------------------------------------------
//  Dialogs
// ---------------------------------------------------------------------------

/**
 * Foundry-native confirmation, falling back to the browser dialog.
 *
 * DialogV2 is the v13+ API; the fallback only matters if that ever moves.
 */
export async function confirmDialog(title, body) {
  const D = foundry.applications?.api?.DialogV2;
  if (D?.confirm) return D.confirm({ window: { title }, content: `<p>${esc(body)}</p>`, modal: true });
  return confirm(body);
}
