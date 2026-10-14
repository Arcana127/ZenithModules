/**
 * Zenith Academy Scroll — notes, backed by Foundry journals
 *
 * The Notes app does not store anything of its own. A notebook is a real
 * `JournalEntry` and each note is a `JournalEntryPage` inside it, which is what
 * makes the whole feature work for free:
 *
 *   - it pops out, because a journal already has a sheet;
 *   - the GM can read and annotate it from the sidebar;
 *   - it survives a scroll data wipe, because it was never scroll data;
 *   - two clients stay in step, because Foundry syncs documents already.
 *
 * There are two books. **Personal** is one entry per student, owned by whoever
 * plays them. **Party** is a single world-wide entry owned by everyone, which is
 * the only difference between the two — the ownership, not the plumbing.
 *
 * Both are found by flag, not by name, so renaming one in the sidebar doesn't
 * orphan it.
 *
 * Who creates what: a player cannot reliably create a `JournalEntry` — that is a
 * world permission, and it is off by default — but a player who *owns* an entry
 * can create, update and delete pages inside it. So the GM client issues the
 * notebooks, once, on ready; players own everything after that.
 */

import { M, esc } from "./core.mjs";

/** Flag naming the actor whose personal notebook an entry is. */
export const NOTEBOOK_FLAG = "notebookFor";

/** Flag marking the one shared notebook. */
export const PARTY_FLAG = "partyNotebook";

/** The two books, in tab order. */
export const BOOKS = [
  { id: "personal", label: "Personal", icon: "fa-user-pen" },
  { id: "party", label: "Party", icon: "fa-users" },
];

/** The folder the notebooks are filed under, created on demand. */
const FOLDER_NAME = "Zenith Scroll Notebooks";

/** Foundry's ownership levels, without assuming the global is there. */
function levels() {
  return globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS ?? { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 };
}

// ---------------------------------------------------------------------------
//  Finding and issuing notebooks
// ---------------------------------------------------------------------------

/** This actor's personal notebook, or null if it hasn't been issued yet. */
export function notebookFor(actor) {
  if (!actor || !globalThis.game?.journal) return null;
  return game.journal.find(j => j.getFlag(M, NOTEBOOK_FLAG) === actor.id) ?? null;
}

/** The one shared notebook, or null if it hasn't been made yet. */
export function partyNotebook() {
  if (!globalThis.game?.journal) return null;
  return game.journal.find(j => !!j.getFlag(M, PARTY_FLAG)) ?? null;
}

/** Whichever book was asked for. Anything unrecognised means personal. */
export function bookFor(actor, book = "personal") {
  return book === "party" ? partyNotebook() : notebookFor(actor);
}

/** The users who should own a given student's personal notebook. */
function ownersOf(actor) {
  return game.users.filter(u => !u.isGM && u.character?.id === actor.id);
}

/** Apply an ownership map to an entry, but only when it is actually different. */
async function reconcileOwnership(entry, want) {
  const have = { default: 0, ...(entry.ownership ?? {}) };
  const keys = new Set([...Object.keys(want), ...Object.keys(have)]);
  const same = [...keys].every(k => (want[k] ?? 0) === (have[k] ?? 0));
  if (same) return entry;

  try { await entry.update({ ownership: want }); }
  catch (e) { console.warn(`${M} | could not update notebook ownership`, e); }
  return entry;
}

/** The folder both books live in. */
async function notebookFolder() {
  let folder = game.folders?.find(f => f.type === "JournalEntry" && f.name === FOLDER_NAME);
  if (!folder) folder = await Folder.create({ name: FOLDER_NAME, type: "JournalEntry" });
  return folder;
}

/**
 * Make sure this actor has a personal notebook, and that whoever plays them
 * owns it.
 *
 * GM-only. Returns the entry, or null if it could not be made — which is not an
 * error worth shouting about, since the app has an empty state for exactly that.
 */
export async function ensureNotebook(actor) {
  if (!actor || !game.user.isGM) return notebookFor(actor);

  const ownership = { default: levels().NONE };
  for (const u of ownersOf(actor)) ownership[u.id] = levels().OWNER;

  const existing = notebookFor(actor);
  // A player reassigned to a different character needs their ownership moved,
  // and only a GM can do that. Cheap to compare, so compare it every load.
  if (existing) return reconcileOwnership(existing, ownership);

  try {
    const folder = await notebookFolder();
    return await JournalEntry.create({
      name: `${actor.name}'s Notes`,
      folder: folder?.id ?? null,
      ownership,
      flags: { [M]: { [NOTEBOOK_FLAG]: actor.id } },
    });
  } catch (e) {
    console.error(`${M} | could not create a notebook for ${actor.name}`, e);
    return null;
  }
}

/**
 * Make sure the shared notebook exists and everyone can write in it.
 *
 * `default: OWNER` is the entire difference between this book and a personal
 * one. It does mean any student can edit or delete any party note, which is
 * what "party notes" means — drop it to OBSERVER in the sidebar if you would
 * rather they could only read.
 */
export async function ensurePartyNotebook() {
  if (!game.user.isGM) return partyNotebook();

  const ownership = { default: levels().OWNER };
  const existing = partyNotebook();
  if (existing) return reconcileOwnership(existing, ownership);

  try {
    const folder = await notebookFolder();
    return await JournalEntry.create({
      name: "Party Notes",
      folder: folder?.id ?? null,
      ownership,
      flags: { [M]: { [PARTY_FLAG]: true } },
    });
  } catch (e) {
    console.error(`${M} | could not create the party notebook`, e);
    return null;
  }
}

/** Issue every notebook the world should have. GM-only; runs once on ready. */
export async function provisionNotebooks() {
  if (!game.user.isGM) return 0;
  let n = 0;
  for (const u of game.users.filter(u => !u.isGM && u.character)) {
    if (await ensureNotebook(u.character)) n++;
  }
  if (await ensurePartyNotebook()) n++;
  return n;
}

// ---------------------------------------------------------------------------
//  Reading and writing notes
// ---------------------------------------------------------------------------

/** Whoever last touched a page, by name rather than by id. */
function editorName(page) {
  const id = page?._stats?.lastModifiedBy;
  if (!id) return "";
  return globalThis.game?.users?.get?.(id)?.name ?? "";
}

/** Every note in a book, most recently edited first. */
export function listNotes(actor, book = "personal") {
  const entry = bookFor(actor, book);
  if (!entry) return [];
  return [...entry.pages]
    .filter(p => p.type === "text")
    .map(p => ({
      id: p.id,
      name: p.name || "Untitled",
      text: htmlToText(p.text?.content ?? ""),
      rich: !isPlainish(p.text?.content ?? ""),
      updated: p._stats?.modifiedTime ?? 0,
      by: book === "party" ? editorName(p) : "",
      editable: !!p.canUserModify?.(game.user, "update"),
    }))
    .sort((a, b) => b.updated - a.updated);
}

/** How many notes are in a book — the tab counters read this. */
export function noteCount(actor, book = "personal") {
  const entry = bookFor(actor, book);
  return entry ? [...entry.pages].filter(p => p.type === "text").length : 0;
}

/** Can this user write in a given book at all? */
export function canWrite(actor, book = "personal") {
  return !!bookFor(actor, book)?.canUserModify?.(game.user, "update");
}

/** Start a new note and return its id. */
export async function createNote(actor, book = "personal", name = "New note") {
  const entry = bookFor(actor, book);
  if (!entry) return null;
  try {
    const [page] = await entry.createEmbeddedDocuments("JournalEntryPage", [{
      name, type: "text", text: { content: "", format: 1 },
    }]);
    return page?.id ?? null;
  } catch (e) {
    console.warn(`${M} | could not add a note`, e);
    return null;
  }
}

/** Write a note's title and plain text back into its page. */
export async function saveNote(actor, book, pageId, { name, text } = {}) {
  const page = bookFor(actor, book)?.pages?.get(pageId);
  if (!page) return false;

  const patch = {};
  if (name !== undefined && name !== page.name) patch.name = name || "Untitled";
  if (text !== undefined) {
    /*
     * Refuse to write plain text over a page that carries real formatting. The
     * scroll's editor is a textarea, so saving would flatten whatever was built
     * in the journal sheet — tables, links, embedded images, all of it. Those
     * pages are shown read-only in the app, which points at the pop-out instead.
     */
    if (!isPlainish(page.text?.content ?? "")) return false;
    patch["text.content"] = textToHtml(text);
    patch["text.format"] = 1;
  }
  if (!Object.keys(patch).length) return true;

  try { await page.update(patch); return true; }
  catch (e) { console.warn(`${M} | note save refused`, e); return false; }
}

export async function deleteNote(actor, book, pageId) {
  const entry = bookFor(actor, book);
  if (!entry?.pages?.get(pageId)) return false;
  try { await entry.deleteEmbeddedDocuments("JournalEntryPage", [pageId]); return true; }
  catch (e) { console.warn(`${M} | note delete refused`, e); return false; }
}

/** Open a notebook in Foundry's own journal window, on a given page. */
export function popOut(actor, book = "personal", pageId = null) {
  const entry = bookFor(actor, book);
  if (!entry) return false;
  try {
    entry.sheet.render(true, pageId ? { pageId } : {});
    return true;
  } catch (e) {
    console.warn(`${M} | could not open the notebook sheet`, e);
    return false;
  }
}

// ---------------------------------------------------------------------------
//  Export
// ---------------------------------------------------------------------------

/**
 * A whole notebook as one Markdown document.
 *
 * Markdown rather than the HTML the pages actually hold, because the point of
 * exporting is to paste a session's notes somewhere that is not Foundry. The
 * conversion is shallow on purpose — headings, emphasis, links and list items,
 * and everything else falls through to text. A page's real content is always
 * still in the journal; this is a copy to read, not the archive.
 */
export function notebookMarkdown(actor, book = "personal") {
  const entry = bookFor(actor, book);
  if (!entry) return "";

  const title = book === "party" ? "Party Notes" : `${actor?.name ?? "Student"} — Notes`;
  const when = new Date().toISOString().slice(0, 10);
  const out = [`# ${title}`, "", `*Exported ${when} from the Zenith Scroll.*`, ""];

  const pages = [...entry.pages]
    .filter(p => p.type === "text")
    .sort((a, b) => (a._stats?.modifiedTime ?? 0) - (b._stats?.modifiedTime ?? 0));

  if (!pages.length) out.push("*(nothing written down)*", "");

  for (const p of pages) {
    out.push(`## ${p.name || "Untitled"}`, "");
    const by = book === "party" ? editorName(p) : "";
    if (by) out.push(`*Last written by ${by}.*`, "");
    out.push(htmlToMarkdown(p.text?.content ?? "") || "*(empty)*", "");
  }

  return out.join("\n");
}

/** Both books at once, for a student who wants the lot. */
export function allNotesMarkdown(actor) {
  const mine = notebookMarkdown(actor, "personal");
  const party = notebookMarkdown(actor, "party");
  return [mine, party].filter(Boolean).join("\n\n---\n\n");
}

const MD_RULES = [
  [/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, n, t) => `\n${"#".repeat(Number(n) + 1)} ${t.trim()}\n`],
  [/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, t) => `\n- ${t.trim()}`],
  [/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, "**$1**"],
  [/<(?:em|i)[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, "*$1*"],
  [/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)"],
  [/<img[^>]*src="([^"]*)"[^>]*>/gi, "![]($1)"],
  [/<hr\s*\/?>/gi, "\n---\n"],
];

/** Shallow HTML to Markdown. Anything not listed above becomes plain text. */
export function htmlToMarkdown(html) {
  let s = String(html ?? "");
  for (const [re, to] of MD_RULES) s = s.replace(re, to);
  return htmlToText(s);
}

// ---------------------------------------------------------------------------
//  Plain text <-> the HTML a journal page stores
// ---------------------------------------------------------------------------

/*
 * A journal page holds HTML; the scroll edits plain text. The conversion is
 * only safe in one direction, so `isPlainish` is the gate that decides whether
 * the scroll is allowed to write at all — anything richer than paragraphs and
 * line breaks would not survive the round trip.
 */
const RICH_TAG = /<(?!\/?(?:p|br|div|span)\b)[a-z][a-z0-9-]*[\s>/]/i;

export function isPlainish(html) {
  return !RICH_TAG.test(String(html ?? ""));
}

const ENTITIES = {
  "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">",
  "&quot;": '"', "&#39;": "'", "&apos;": "'",
};

export function htmlToText(html) {
  return String(html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div)\s*>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;|&apos;/gi, m => ENTITIES[m.toLowerCase()] ?? m)
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function textToHtml(text) {
  const body = String(text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!body) return "";
  return body
    .split(/\n{2,}/)
    .map(p => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}
