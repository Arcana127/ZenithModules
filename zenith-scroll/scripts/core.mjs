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
 */
export const F = {
  profile: "profile",    // studentId, year, cohort, dormitory, status, statusPreset
  academic: "academic",  // schedule, gift, giftDescription, giftLevel, giftMilestones,
                         // nextEvent, nextEventDays, notes
  social: "social",      // conversations, relationships
  media: "media",        // gallery
  system: "system",      // announcements, dismissedAnnouncements
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

/** Decorative corner flourish, drawn inline so the module ships no image assets. */
export const CORNER_SVG =
  `<svg viewBox="0 0 28 28" width="28" height="28">` +
  `<path d="M2,2 L12,2 L12,4 L4,4 L4,12 L2,12 Z" fill="#c8a030" opacity="0.7"/>` +
  `<circle cx="3" cy="3" r="2" fill="#1a8050" opacity="0.9"/></svg>`;

// ---------------------------------------------------------------------------
//  DOM helper
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

/** Conversation id. Every participant in a thread must share one of these. */
export function convId() {
  return "conv_" + Math.random().toString(36).slice(2, 10);
}

/**
 * Announcement id. Dismissals key off this rather than the array position, so
 * editing the announcement list doesn't shift everyone's dismissals onto the
 * wrong rows.
 */
export function annId() {
  return "ann_" + Math.random().toString(36).slice(2, 10);
}

// ---------------------------------------------------------------------------
//  Formatting
// ---------------------------------------------------------------------------

export function yearLabel(y) {
  return { 1: "First Year", 2: "Second Year", 3: "Third Year", 4: "Fourth Year" }[y]
    ?? `Year ${y}`;
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
