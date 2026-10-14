/**
 * Zenith Academy Scroll — the camera
 *
 * Captures what the player is actually looking at on the canvas and files it in
 * their gallery.
 *
 * Two things make this simpler than it sounds. First, each client renders the
 * scene through its own eyes, so a player's capture already carries their
 * vision, their fog and nothing they cannot see — there is no filtering to do.
 * Second, the capture is a render of `canvas.stage` into a texture rather than a
 * read of the screen buffer: the stage already carries the pan and zoom, so the
 * result is the viewport, and rendering it fresh sidesteps the whole question of
 * whether the drawing buffer was preserved after the last frame.
 *
 * What it does *not* capture is the HTML on top — chat, the sidebar, the scroll
 * itself. That is the desired photo, not a limitation to apologise for.
 *
 * Storage is the awkward half. A viewport JPEG is a few hundred kilobytes, far
 * too much for an actor flag, so it becomes a file. Most players do not have
 * Foundry's upload permission, so when they don't, the capture is relayed to the
 * GM's client and written there — the same shape as the message relay.
 */

import { M } from "./core.mjs";
import { referencedImages } from "./data.mjs";

/** Longest edge of a stored capture, in pixels, before JPEG compression. */
export const MAX_WIDTH = 1600;

/** JPEG quality. High enough for a keepsake, low enough to go over a socket. */
export const QUALITY = 0.82;

// ---------------------------------------------------------------------------
//  Taking the picture
// ---------------------------------------------------------------------------

/** Is there a canvas worth photographing? */
export function canCapture() {
  return !!(globalThis.canvas?.ready && globalThis.canvas.app?.renderer && globalThis.PIXI);
}

/**
 * Render the current viewport to a JPEG data URL.
 *
 * Returns `{ dataUrl, width, height }`. Throws with a message fit for a
 * notification if the canvas isn't in a state to be photographed.
 */
export async function captureViewport({ maxWidth = MAX_WIDTH, quality = QUALITY } = {}) {
  if (!canCapture()) throw new Error("There is no scene on screen to photograph.");

  const renderer = canvas.app.renderer;
  const w = Math.max(1, Math.round(renderer.screen.width));
  const h = Math.max(1, Math.round(renderer.screen.height));

  let tex = null;
  try {
    tex = PIXI.RenderTexture.create({ width: w, height: h, resolution: 1 });
    renderToTexture(renderer, tex);
    // PIXI 7 returns an HTMLCanvasElement, PIXI 8 an ICanvas; both draw and both
    // carry toDataURL, which is all this needs.
    const raw = await renderer.extract.canvas(tex);
    return downscale(raw, maxWidth, quality);
  } finally {
    try { tex?.destroy(true); } catch (e) { /* already gone */ }
  }
}

/**
 * Draw the stage into a texture, whichever PIXI this Foundry ships.
 *
 * PIXI 7 takes `(displayObject, {renderTexture})`; PIXI 8 takes a single
 * `{container, target}` object. The 7-shaped call still works on 8 through a
 * deprecation shim, but only until it doesn't, so the 8-shaped call is the
 * fallback rather than the other way round.
 */
function renderToTexture(renderer, tex) {
  try {
    renderer.render(canvas.stage, { renderTexture: tex, clear: true });
  } catch (e) {
    renderer.render({ container: canvas.stage, target: tex, clear: true });
  }
}

/**
 * Fit a canvas inside `maxWidth` and encode it as JPEG.
 *
 * The black fill matters: the scene is drawn on transparency wherever there is
 * no tile, JPEG has no alpha channel, and an unfilled canvas encodes those
 * pixels as white. A photograph of a dark dungeon should not come back with a
 * white border.
 */
function downscale(src, maxWidth, quality) {
  const sw = src.width, sh = src.height;
  const scale = Math.min(1, maxWidth / Math.max(1, sw));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);

  return { dataUrl: out.toDataURL("image/jpeg", quality), width: w, height: h };
}

// ---------------------------------------------------------------------------
//  Filing it
// ---------------------------------------------------------------------------

/** Where captures are written, under the configured gallery folder. */
export function captureDir() {
  let base = "scroll-gallery";
  try { base = String(game.settings.get(M, "galleryFolder") || base); } catch (e) { /* unregistered */ }
  return `${base.replace(/\/+$/, "")}/captures`;
}

/** A filename that sorts by date and cannot collide between students. */
export function captureName(actor) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `zs-${actor?.id ?? "unknown"}-${stamp}.jpg`;
}

/** Foundry's file picker, wherever this core version keeps it. */
function filePicker() {
  return globalThis.foundry?.applications?.apps?.FilePicker?.implementation
      ?? globalThis.FilePicker
      ?? null;
}

/** Can this user write files themselves, or does the capture need relaying? */
export function canUploadDirectly() {
  try { return !!filePicker() && !!game.user?.can?.("FILES_UPLOAD"); }
  catch (e) { return false; }
}

/**
 * Write a data URL into the world's file store and return the stored path.
 *
 * Foundry has no "make these directories" call, so each segment is created in
 * turn and an "already exists" is the expected answer rather than a failure.
 */
export async function uploadCapture(dataUrl, dir, name) {
  const FP = filePicker();
  if (!FP) throw new Error("This Foundry build has no file picker to upload through.");

  await makeDirs(FP, dir);

  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], name, { type: "image/jpeg" });
  const res = await FP.upload("data", dir, file, {}, { notify: false });

  const path = res?.path ?? `${dir}/${name}`;
  if (!path) throw new Error("The upload returned no path.");
  return path;
}

async function makeDirs(FP, dir) {
  const parts = dir.split("/").filter(Boolean);
  let sofar = "";
  for (const p of parts) {
    sofar = sofar ? `${sofar}/${p}` : p;
    try { await FP.createDirectory("data", sofar); }
    catch (e) { /* almost always "EEXIST", which is the good outcome */ }
  }
}

// ---------------------------------------------------------------------------
//  Photos still in the darkroom
// ---------------------------------------------------------------------------

/*
 * A relayed capture goes to the GM's client, gets written, and comes back as a
 * gallery entry some unknowable number of milliseconds later. Without a record
 * of that gap the player takes a photo and nothing happens, so these are the
 * ones in flight: held in memory only, keyed by a token the GM echoes back.
 *
 * The dataUrl is kept alongside, which is why the placeholder can be the actual
 * photograph rather than a grey box — it is already in memory, and the tile is
 * exactly what it will be once it has developed.
 */
const pending = new Map();
let devSeq = 0;

/** How long to wait for the GM's client before calling it a failure. */
export const DEVELOP_TIMEOUT = 90_000;

/** Start tracking a capture that has been sent off to be written. */
export function beginDeveloping(dataUrl, caption) {
  const id = "dev_" + Math.random().toString(36).slice(2, 10);
  pending.set(id, {
    id, dataUrl, caption: String(caption ?? ""),
    ts: Date.now(),
    // Two captures taken in the same millisecond share a `ts`, so the order they
    // were taken in is carried separately rather than left to the sort's mercy.
    seq: ++devSeq,
    failed: false, reason: "",
  });
  return id;
}

/** Everything still developing, newest first. */
export function developing() {
  const now = Date.now();
  for (const p of pending.values()) {
    if (!p.failed && now - p.ts > DEVELOP_TIMEOUT) {
      p.failed = true;
      p.reason = "It never came back.";
    }
  }
  return [...pending.values()].sort((a, b) => (b.ts - a.ts) || (b.seq - a.seq));
}

/** A capture that arrived, or one the player has dismissed. */
export function finishDeveloping(id) {
  return pending.delete(id);
}

/** A capture the GM's client could not write. It stays visible until dismissed. */
export function failDeveloping(id, reason = "") {
  const p = pending.get(id);
  if (!p) return false;
  p.failed = true;
  p.reason = String(reason || "It could not be saved.");
  return true;
}

// ---------------------------------------------------------------------------
//  Captures nothing points at any more
// ---------------------------------------------------------------------------

/**
 * Pull the actor id back out of a capture filename, if it is one of ours.
 *
 * `zs-<actor id>-<ISO stamp>.jpg`. The id is matched up to the stamp rather than
 * to the first hyphen: Foundry's own ids never contain one, but an id that came
 * from somewhere else might, and reading half of it would name the wrong student.
 */
export function ownerOfCapture(path) {
  const file = String(path).split("/").pop() ?? "";
  return file.match(/^zs-(.+?)-\d{4}-\d{2}-\d{2}T[\d-]+\.\w+$/)?.[1]
      ?? file.match(/^zs-([^-]+)-/)?.[1]
      ?? null;
}

/**
 * Every capture file no gallery entry points at.
 *
 * Removing an image from the gallery deliberately leaves the file alone — the
 * same photo may be in three other galleries. That is the right call per-image
 * and the wrong one over a campaign, so this is the sweep that finds what the
 * decision left behind.
 *
 * Comparison is on decoded paths: `FilePicker.browse` percent-encodes what it
 * returns and a flag holds whatever was written into it, so the two forms of
 * the same file would otherwise never match.
 */
export async function findOrphanCaptures() {
  const FP = filePicker();
  const dir = captureDir();
  const out = { dir, total: 0, orphans: [], error: "" };

  if (!FP) { out.error = "This Foundry build has no file picker to browse with."; return out; }
  if (!game.user?.isGM) { out.error = "Only a GM can sweep the capture folder."; return out; }

  let listing;
  try { listing = await FP.browse("data", dir); }
  catch (e) {
    // A world that has never taken a photo has no folder, which is not a fault.
    out.error = `Nothing to sweep — ${dir}/ does not exist yet.`;
    return out;
  }

  const files = (listing?.files ?? []).map(f => decodeURIComponent(String(f)));
  out.total = files.length;

  // Not just galleries: a capture attached to a message, or pinned to a map, is
  // still on screen somewhere even if nobody has it filed. See referencedImages.
  const referenced = referencedImages();

  out.orphans = files
    .filter(f => !referenced.has(f))
    .map(path => {
      const ownerId = ownerOfCapture(path);
      const actor = ownerId ? game.actors.get(ownerId) : null;
      return { path, name: path.split("/").pop(), ownerId, owner: actor?.name ?? "", actor };
    });

  return out;
}

/**
 * A script that removes the given files.
 *
 * Foundry's client API can browse, upload and make directories. It cannot
 * delete, and no core version has ever been able to — so the honest thing is to
 * hand over the exact commands rather than pretend. Run it from the `Data`
 * folder of your Foundry user data directory.
 */
export function deletionScript(orphans, { shell = "powershell" } = {}) {
  const paths = orphans.map(o => o.path);
  if (shell === "bash") {
    return ["#!/bin/sh", "# Run from the Data folder of your Foundry user data directory.",
      ...paths.map(p => `rm -f "${p.replace(/"/g, '\\"')}"`)].join("\n") + "\n";
  }
  return ["# Run from the Data folder of your Foundry user data directory.",
    "# e.g.  cd \"$env:LOCALAPPDATA\\FoundryVTT\\Data\"",
    ...paths.map(p => `Remove-Item -LiteralPath '${p.replace(/'/g, "''")}' -ErrorAction SilentlyContinue`),
  ].join("\r\n") + "\r\n";
}
