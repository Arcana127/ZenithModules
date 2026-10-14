/**
 * ============================================================================
 *  Zenith Academy Scroll  v1.8
 *  Foundry VTT v13 / v14
 * ============================================================================
 *
 * An in-world magitech bracelet for the Zenith Academy campaign. It projects a
 * screen: lock screen, home app grid, and apps for profile, schedule, Gift
 * progression, messages, contacts, notices and gallery — with a GM Command
 * Center behind it.
 *
 * This file is the entry point — settings registration and hook wiring only.
 * The implementation lives in:
 *
 *   core.mjs       constants, dependency-free helpers, the singleton registry
 *   world.mjs      world-scope content (notices, calendar) + the C1 migration
 *   data.mjs       actor-flag load/save, defaults, migration, derived reads
 *   socket.mjs     GM message relay, toasts, messaging availability
 *   ui-scroll.mjs  ScrollIcon + ScrollUI (the player-facing device)
 *   ui-gm.mjs      GMPanel (the Command Center)
 *   api.mjs        ZenithAPI (macro surface)
 *
 * Only this file is listed in module.json; the rest are pulled in as imports.
 */

import { M, F, app, DEFAULT_CURRENCIES, currencyList } from "./core.mjs";
import {
  loadSection, saveSection, playerActor, migrateIfNeeded, backfillTimestamps, portraitOf,
} from "./data.mjs";
import { WS, SCHEMA_VERSION, seedWorldContent } from "./world.mjs";
import { initSocket } from "./socket.mjs";
import { ScrollIcon, ScrollUI } from "./ui-scroll.mjs";
import { GMPanel } from "./ui-gm.mjs";
import { ZenithAPI } from "./api.mjs";
import { provisionNotebooks, ensureNotebook, NOTEBOOK_FLAG } from "./notes.mjs";
import { migrateGiftTrees } from "./gift.mjs";

// ===========================================================================
//  RECENTRE
// ===========================================================================

/**
 * Put the bracelet back in the middle of the screen.
 *
 * The position is a per-user flag, so this is per-user too: three ways in (the
 * module settings sheet, Shift+G, the macro API) and one implementation.
 */
export function recentreScroll() {
  if (app.icon?.centre()) ui.notifications.info("Scroll recentred.");
  else ui.notifications.warn("The scroll is not on screen yet.");
}

/**
 * The settings-sheet button.
 *
 * `registerMenu` only accepts a FormApplication or ApplicationV2 subclass and,
 * when the button is clicked, calls `render()` on a fresh instance of it. There
 * is no form to show here — rendering *is* the action — so this renders nothing
 * and does the work instead. Built lazily because the class has to be declared
 * against whichever base the running core actually provides.
 */
function recentreMenuClass() {
  const V2 = globalThis.foundry?.applications?.api?.ApplicationV2;
  if (!V2) return null;
  return class ZenithRecentreMenu extends V2 {
    static DEFAULT_OPTIONS = { id: "zenith-scroll-recentre" };
    async render() {
      recentreScroll();
      return this;
    }
  };
}

// ===========================================================================
//  SETTINGS
// ===========================================================================

function registerSettings() {
  // --- configurable, shown in the module settings sheet ---

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

  game.settings.register(M, "marksItemName", {
    name: "Marks Item Name",
    hint: "Legacy. The Bank app's currency list replaces this; it is still honoured " +
          "if you renamed your Marks item before v1.8.",
    scope: "world", config: true, type: String, default: "marks",
  });

  /*
   * A button rather than a value. `restricted: false` matters: the bracelet's
   * position lives on each user's own flag, so every player needs their own way
   * to reach this, not just the GM.
   *
   * Wrapped, because a core change to what `registerMenu` accepts should cost
   * the settings sheet a button, not the whole module its init.
   */
  try {
    const Menu = recentreMenuClass();
    if (Menu) {
      game.settings.registerMenu(M, "recentreScroll", {
        name: "Scroll Position",
        label: "Recentre the Scroll",
        hint: "Move the bracelet back to the middle of the screen if it has been " +
              "dragged somewhere you cannot reach. Shift+G does the same thing.",
        icon: "fa-solid fa-crosshairs",
        type: Menu,
        restricted: false,
      });
    }
  } catch (e) {
    console.error(`${M} | could not register the recentre button`, e);
  }

  game.settings.register(M, "useTokenImages", {
    name: "Use Token Images",
    hint: "Draw the small circular avatars from each actor's token art rather than " +
          "their portrait. The large contact detail portrait always uses the portrait.",
    scope: "world", config: true, type: Boolean, default: true,
  });

  // --- world content and configuration, edited elsewhere, not this sheet ---

  /*
   * The currency list behind the Bank app. Not `config: true` because an array
   * of objects has no usable editor in the settings sheet; the Command Center's
   * Bank tab writes it.
   */
  game.settings.register(M, "currencies", {
    scope: "world", config: false, type: Array,
    default: DEFAULT_CURRENCIES.map(c => ({ ...c })),
  });

  /*
   * Danger Zone passphrase: salt plus hash, never the passphrase itself. World
   * settings sync to every connected client, so a plaintext passphrase here
   * would be readable by any player with a console open.
   */
  game.settings.register(M, "resetHash", {
    scope: "world", config: false, type: Object, default: {},
  });

  game.settings.register(M, WS.announcements, {
    scope: "world", config: false, type: Array, default: [],
  });

  game.settings.register(M, WS.events, {
    scope: "world", config: false, type: Array, default: [],
  });

  game.settings.register(M, WS.maps, {
    scope: "world", config: false, type: Array, default: [],
  });

  game.settings.register(M, WS.queued, {
    scope: "world", config: false, type: Array, default: [],
  });

  game.settings.register(M, WS.giftTrees, {
    scope: "world", config: false, type: Array, default: [],
  });

  game.settings.register(M, WS.seeded, {
    scope: "world", config: false, type: Boolean, default: false,
  });

  game.settings.register(M, WS.schemaVersion, {
    scope: "world", config: false, type: Number, default: 0,
  });
}

// ===========================================================================
//  KEYBINDINGS
// ===========================================================================

/**
 * Shift+G recentres the bracelet.
 *
 * Registered rather than hung off a raw `keydown` listener so it shows up in
 * Configure Controls, can be rebound by anyone who has already spent Shift+G on
 * something else, and stays quiet while a text field has focus — Foundry's
 * keyboard manager handles all three.
 */
function registerKeybindings() {
  if (!game.keybindings?.register) return;   // core too old to have them
  game.keybindings.register(M, "recentreScroll", {
    name: "Recentre the Scroll",
    hint: "Move the bracelet back to the middle of the screen.",
    editable: [{ key: "KeyG", modifiers: ["Shift"] }],
    onDown: () => { recentreScroll(); return true; },
    restricted: false,
  });
}

// ===========================================================================
//  LIFECYCLE
// ===========================================================================

Hooks.once("init", () => {
  registerSettings();
  registerKeybindings();
});

Hooks.once("ready", async () => {
  // Bring any actor still on the pre-split v7 flag layout up to date
  for (const a of game.actors) await migrateIfNeeded(a);

  // C1: lift notices and events out of actor flags into world settings, once.
  // GM-only — a player cannot write a world setting, and does not need to.
  if (game.user.isGM) {
    try { await seedWorldContent(); }
    catch (e) { console.error(`${M} | world content seeding failed`, e); }
  }

  // v1.12: lift any actor-local Gift tree into the world library, once. GM-only
  // for the same reason — the library is a world setting.
  if (game.user.isGM) {
    try { await migrateGiftTrees(); }
    catch (e) { console.error(`${M} | Gift tree migration failed`, e); }
  }

  // Notes are journal pages, and a player cannot create a JournalEntry — that
  // is a world permission and it is off by default. The GM's client issues the
  // notebooks; every player owns theirs from then on.
  if (game.user.isGM) {
    try { await provisionNotebooks(); }
    catch (e) { console.error(`${M} | notebook provisioning failed`, e); }
  }

  // C4: stamp sort timestamps onto pre-v1.6 messages in actors we can write.
  // Silent and best-effort; a failure here is cosmetic, not load-bearing.
  for (const a of game.actors) {
    if (!a.isOwner) continue;
    try { await backfillTimestamps(a); }
    catch (e) { console.warn(`${M} | timestamp backfill skipped for ${a.name}`, e); }
  }

  app.icon = new ScrollIcon();
  app.icon.inject();
  app.ui = new ScrollUI();
  app.gm = new GMPanel();

  initSocket();

  const mod = game.modules.get(M);
  if (mod) mod.api = ZenithAPI;

  const pc = playerActor();
  if (pc) app.icon.updateBadge(pc);

  console.log(`${M} | Zenith Academy Scroll v1.8 ready (schema ${SCHEMA_VERSION})`);
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

// World content is shared, so a GM editing the notice board has to reach every
// open device — there is no actor update to ride along on.
Hooks.on("updateSetting", setting => {
  const key = setting?.key ?? "";
  if (key === `${M}.${WS.announcements}` || key === `${M}.${WS.events}` ||
      key === `${M}.${WS.maps}` || key === `${M}.${WS.giftTrees}` ||
      key === `${M}.currencies` ||
      key === `${M}.useTokenImages`) app.ui?.refresh();
});

// A player coming or going changes the aether meter and the contact presence dots
Hooks.on("userConnected", () => app.ui?.refresh());

// ===========================================================================
//  NOTES  —  following the journal the app is a view onto
// ===========================================================================

/**
 * Repaint the Notes app when the journal behind it changes.
 *
 * The three page hooks have different signatures — update carries a `changed`
 * object the other two don't — but the user id is the last argument in all of
 * them, which is the only part this needs.
 */
function noteChanged(page, ...rest) {
  const ui_ = app.ui;
  if (!ui_?.open_ || ui_.appId !== "notes" || !ui_.actor) return;

  // Somebody else's notebook is none of this device's business.
  const owner = page?.parent?.getFlag?.(M, NOTEBOOK_FLAG);
  if (owner && owner !== ui_.actor.id) return;

  // Our own debounced autosave comes straight back as an update. Repainting on
  // that would fight the textarea the player is still typing into.
  const userId = rest[rest.length - 1];
  if (userId === game.user.id && ui_._noteEcho && ui_._noteEcho === page?.id) return;

  ui_.refresh();
}

Hooks.on("createJournalEntryPage", noteChanged);
Hooks.on("updateJournalEntryPage", noteChanged);
Hooks.on("deleteJournalEntryPage", noteChanged);

// Renaming the notebook or having it shared with you both land here.
Hooks.on("updateJournalEntry", entry => {
  if (app.ui?.appId !== "notes") return;
  const owner = entry?.getFlag?.(M, NOTEBOOK_FLAG);
  if (!owner || owner === app.ui.actor?.id) app.ui.refresh();
});

// A player assigned a character after the world loaded needs a notebook, and
// one reassigned needs the ownership moved. Only a GM can do either.
Hooks.on("updateUser", async (user, changed) => {
  if (!game.user.isGM || !("character" in changed) || !user.character) return;
  try { await ensureNotebook(user.character); }
  catch (e) { console.warn(`${M} | could not issue a notebook to ${user.name}`, e); }
});

// Currency is an inventory item, so the Student ID and Bank apps have to follow
// item changes too — all of them now, not just the one called "marks".
function isCurrencyItem(i) {
  const name = i.name?.toLowerCase();
  if (!name) return false;
  if (currencyList().some(c => c.itemName.toLowerCase() === name)) return true;
  let legacy = "";
  try { legacy = String(game.settings.get(M, "marksItemName") || ""); } catch (e) { /* unregistered */ }
  return !!legacy && name === legacy.toLowerCase();
}
const refreshIfMine = i => {
  if (isCurrencyItem(i) && app.ui?.actor?.id === i.actor?.id) app.ui.refresh();
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
          name: actor.name, title: "", img: portraitOf(actor),
          rank: 0, category: "Other", history: [],
        });
        await saveSection(u.character, F.social, s);
      }

      ui.notifications.info(`${actor.name} added as contact.`);
      app.ui?.refresh();
    },
  });
});
