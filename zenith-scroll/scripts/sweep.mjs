/**
 * Zenith Academy Scroll — the capture sweep
 *
 * Removing an image from a gallery deliberately leaves the file alone: the same
 * photo may sit in three other galleries, and a student tidying their own has no
 * business reaching into anyone else's. That is the right call per-image and the
 * wrong one over a campaign, so this is the tool that finds what the decision
 * left behind and asks what to do about it.
 *
 * One hard limit shapes the whole thing: **Foundry's client API cannot delete a
 * file.** `FilePicker` browses, uploads and makes directories, and no core
 * version has ever offered more. So "delete" here means handing over the exact
 * commands to run, printed to the console and offered as a script — which is
 * honest, and is the same thing a delete button would have had to do anyway.
 *
 * "Keep" is the more interesting half: an orphan's filename carries the actor id
 * it was taken for, so a photo removed by mistake can be put straight back into
 * the right student's gallery.
 */

import { M, el, btn } from "./core.mjs";
import { findOrphanCaptures, deletionScript } from "./capture.mjs";
import { addGalleryImage } from "./data.mjs";

/**
 * Sweep, report to the console, and open the keep-or-delete list.
 *
 * The console report is the part that survives: it is copy-pasteable, it is
 * still there after the dialog is closed, and a `console.table` of forty files
 * is far easier to read than forty rows in a 480px panel.
 */
export async function sweepCaptures() {
  const res = await findOrphanCaptures();

  if (res.error) {
    ui.notifications.warn(res.error);
    console.warn(`${M} | capture sweep: ${res.error}`);
    return res;
  }

  console.group(`${M} | capture sweep — ${res.dir}`);
  console.log(`${res.total} file${res.total === 1 ? "" : "s"} on disk, ` +
              `${res.orphans.length} with nothing pointing at ${res.orphans.length === 1 ? "it" : "them"}.`);
  if (res.orphans.length) {
    console.table(res.orphans.map(o => ({
      file: o.name,
      "taken for": o.owner || "(unknown)",
      path: o.path,
    })));
    console.log("Foundry cannot delete files from the client. `deletionScript()` " +
                "below is what to run from your Data folder if you want them gone.");
  }
  console.groupEnd();

  if (!res.orphans.length) {
    ui.notifications.info(`Nothing to sweep — all ${res.total} captures are still in a gallery.`);
    return res;
  }

  openSweepDialog(res);
  return res;
}

/**
 * The list, with a choice per file.
 *
 * Built by hand rather than through DialogV2's content string because every row
 * needs a live checkbox and a thumbnail, and because the two actions do
 * genuinely different things — one writes to actor flags, the other writes a
 * file to the GM's downloads.
 */
export function openSweepDialog(res) {
  document.getElementById("zs-sweep")?.remove();

  const root = el("div", {
    id: "zs-sweep", role: "dialog", "aria-modal": "true", "aria-label": "Orphaned captures",
    onclick: e => { if (e.target.id === "zs-sweep") close(); },
  });
  const close = () => root.remove();

  const panel = el("div", { class: "zsw-panel" });
  panel.appendChild(el("div", { class: "zsw-head", html:
    `<i class="fa-solid fa-broom" aria-hidden="true"></i> Orphaned captures` }));
  panel.appendChild(el("div", { class: "zsw-sub", text:
    `${res.orphans.length} of ${res.total} file${res.total === 1 ? "" : "s"} in ${res.dir}/ ` +
    `${res.orphans.length === 1 ? "is" : "are"} in nobody's gallery.` }));

  const list = el("div", { class: "zsw-list" });
  const boxes = new Map();

  for (const o of res.orphans) {
    const row = el("label", { class: "zsw-row" });

    const box = el("input", { type: "checkbox", class: "zsw-box" });
    box.checked = true;
    boxes.set(o.path, box);
    row.appendChild(box);

    row.appendChild(el("img", { class: "zsw-thumb", src: o.path, alt: "", loading: "lazy" }));

    const info = el("div", { class: "zsw-info" });
    info.appendChild(el("div", { class: "zsw-name", text: o.name }));
    info.appendChild(el("div", {
      class: "zsw-owner",
      text: o.owner ? `taken for ${o.owner}` : "no student in the filename",
    }));
    row.appendChild(info);

    list.appendChild(row);
  }
  panel.appendChild(list);

  const chosen = () => res.orphans.filter(o => boxes.get(o.path)?.checked);

  const tick = (on) => btn("zsw-mini", on ? "Check every file" : "Uncheck every file", () => {
    for (const b of boxes.values()) b.checked = on;
  }, { text: on ? "All" : "None" });

  const mini = el("div", { class: "zsw-mini-row" });
  mini.append(tick(true), tick(false));
  panel.appendChild(mini);

  const acts = el("div", { class: "zsw-acts" });

  acts.appendChild(btn("zsw-keep", "Put the checked files back in their owners' galleries", async () => {
    const picked = chosen().filter(o => o.actor);
    if (!picked.length) return ui.notifications.warn("None of the checked files name a student.");
    let n = 0;
    for (const o of picked) {
      if (await addGalleryImage(o.actor, { src: o.path, caption: "" })) n++;
    }
    ui.notifications.info(`${n} photo${n === 1 ? "" : "s"} put back.`);
    close();
  }, { html: '<i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Keep — restore to owners' }));

  acts.appendChild(btn("zsw-del", "Get the commands that delete the checked files", () => {
    const picked = chosen();
    if (!picked.length) return ui.notifications.warn("Nothing is checked.");
    const script = deletionScript(picked);

    console.group(`${M} | delete ${picked.length} orphaned capture${picked.length === 1 ? "" : "s"}`);
    console.log("Foundry's client API cannot delete files. Run this from the Data " +
                "folder of your Foundry user data directory:");
    console.log(script);
    console.groupEnd();

    download(script, "zenith-scroll-delete-captures.ps1");
    ui.notifications.info(`Script for ${picked.length} file${picked.length === 1 ? "" : "s"} ` +
                          "downloaded, and printed to the console (F12).");
    close();
  }, { html: '<i class="fa-solid fa-trash" aria-hidden="true"></i> Delete — get the script' }));

  acts.appendChild(btn("zsw-cancel", "Close without doing anything", close, { text: "Close" }));
  panel.appendChild(acts);

  panel.appendChild(el("div", { class: "zsw-note", html:
    "Foundry has no client-side delete, so <b>Delete</b> hands you the exact " +
    "commands rather than pretending. The full list is in the console either way." }));

  root.appendChild(panel);
  document.body.appendChild(root);
}

/** Hand the GM a text file. */
function download(text, name) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = el("a", { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (e) {
    console.error(`${M} | could not offer the script as a file; it is above`, e);
  }
}
