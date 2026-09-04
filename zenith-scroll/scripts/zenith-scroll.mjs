/**
 * ============================================================================
 *  Zenith Academy Scroll  v1.6
 *  Foundry VTT v13 / v14
 * ============================================================================
 *
 * An in-world magitech scroll HUD for the Zenith Academy campaign: profile,
 * schedule, Gift progression, messages, relationships and gallery for players,
 * with a GM Command Center behind it.
 *
 * This file is the entry point — settings registration and hook wiring only.
 * The implementation lives in:
 *
 *   core.mjs       constants, dependency-free helpers, the singleton registry
 *   data.mjs       actor-flag load/save, defaults, migration, derived reads
 *   socket.mjs     GM message relay, toasts, messaging availability
 *   ui-scroll.mjs  ScrollIcon + ScrollUI (the player-facing scroll)
 *   ui-gm.mjs      GMPanel (the Command Center)
 *   api.mjs        ZenithAPI (macro surface)
 *
 * Only this file is listed in module.json; the rest are pulled in as imports.
 */

import { M, F, app } from "./core.mjs";
import { loadSection, saveSection, playerActor, migrateIfNeeded } from "./data.mjs";
import { initSocket } from "./socket.mjs";
import { ScrollIcon, ScrollUI } from "./ui-scroll.mjs";
import { GMPanel } from "./ui-gm.mjs";
import { ZenithAPI } from "./api.mjs";

// ===========================================================================
//  SETTINGS
// ===========================================================================

function registerSettings() {
  game.settings.register(M, "galleryFolder", {
    name: "Gallery Image Folder",
    hint: "Default folder path for browsing gallery images.",
    scope: "world", config: true, type: String, default: "scroll-gallery",
  });

  game.settings.register(M, "enablePlayerMessaging", {
    name: "Player-to-Player Messaging",
    hint: "Allow students to message each other. GM client must be connected to relay.",
    scope: "world", config: true, type: Boolean, default: true,
  });
}

// ===========================================================================
//  LIFECYCLE
// ===========================================================================

Hooks.once("init", () => registerSettings());

Hooks.once("ready", async () => {
  // Bring any actor still on the pre-split v7 flag layout up to date
  for (const a of game.actors) await migrateIfNeeded(a);

  app.icon = new ScrollIcon();
  app.icon.inject();
  app.ui = new ScrollUI();
  app.gm = new GMPanel();

  initSocket();

  const mod = game.modules.get(M);
  if (mod) mod.api = ZenithAPI;

  const pc = playerActor();
  if (pc) app.icon.updateBadge(pc);

  console.log(`${M} | Zenith Academy Scroll v1.6 ready`);
});

// ===========================================================================
//  REACTIVITY
// ===========================================================================

Hooks.on("updateActor", (a, changed, options, userId) => {
  // Our own autosaves (relationship notes, read receipts, student-ID assignment)
  // tag themselves silent so they don't tear down and rebuild the panel the user
  // is currently typing into.
  if (options?.zenithSilent && userId === game.user.id) {
    app.icon?.updateBadge(playerActor());
    return;
  }
  if (app.ui?.actor?.id === a.id) app.ui.refresh();
  app.icon?.updateBadge(playerActor());
});

// Marks are an inventory item, so the home tab has to follow item changes too
const isMarks = i => i.name?.toLowerCase() === "marks";
const refreshIfMine = i => {
  if (isMarks(i) && app.ui?.actor?.id === i.actor?.id) app.ui.refresh();
};
Hooks.on("updateItem", refreshIfMine);
Hooks.on("createItem", refreshIfMine);
Hooks.on("deleteItem", refreshIfMine);

// ===========================================================================
//  ACTOR DIRECTORY CONTEXT MENU
// ===========================================================================

/**
 * v13 renamed getActorDirectoryEntryContext -> getActorContextOptions and stopped
 * calling the old one, which is why these entries silently vanished. Entries now
 * receive a plain HTMLElement (data-entry-id), not a jQuery object; the [0]
 * fallback keeps this working if it is ever handed a jQuery wrapper.
 */
function ctxActor(li) {
  const e = li?.[0] ?? li;
  const id = e?.dataset?.entryId ?? e?.dataset?.documentId;
  return id ? game.actors.get(id) : null;
}

Hooks.on("getActorContextOptions", (_directory, opts) => {
  opts.push({
    name: "Open in Scroll Command Center",
    icon: '<i class="fa-solid fa-scroll"></i>',
    condition: () => game.user.isGM,
    callback: li => {
      const a = ctxActor(li);
      if (a) app.gm?.open(a);
    },
  });

  opts.push({
    name: "Add as Contact to All Students",
    icon: '<i class="fa-solid fa-user-plus"></i>',
    condition: () => game.user.isGM,
    callback: async li => {
      const actor = ctxActor(li);
      if (!actor) return;

      for (const u of game.users.filter(u => !u.isGM && u.character)) {
        const s = loadSection(u.character, F.social);
        if (s.relationships.find(r => r.name === actor.name)) continue;
        s.relationships.push({
          name: actor.name, title: "", img: actor.img,
          rank: 0, category: "Other", history: [],
        });
        await saveSection(u.character, F.social, s);
      }

      ui.notifications.info(`${actor.name} added as contact.`);
      app.ui?.refresh();
    },
  });
});
