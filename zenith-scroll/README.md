# Zenith Academy Scroll

A Foundry VTT module for the **Zenith Academy** campaign: an in-world magitech
bracelet each student wears, which projects a personal screen.

Players open it to check their student ID, class schedule, Gift progression,
messages, contacts, the school notice board, their photo gallery, their bank
balance and their alerts. The GM edits all of it from a Command Center behind
the scenes.

- **Foundry:** v13 minimum, verified on v14
- **Systems:** system-agnostic (currency read from an inventory item's quantity,
  the item names configurable)
- **Assets:** none — the bracelet is inline SVG, everything else is CSS

---

## The device

The bracelet sits on the canvas and can be dragged anywhere. Clicking it (or
tabbing to it and pressing Enter) unfurls the projection from the stone.

```
  bracelet  ──click──>  lock screen  ──touch──>  home grid  ──>  app
                                                     ^             │
                                                     └─── back ────┘
```

**Lock screen** — clock, in-world date, device name, the next school event, and
what you've missed. **Home** — an app grid with an alert bell in its header; a
dock pins Home, Messages, Contacts and Notices.

There is no status bar as of v1.8. Of the four things it carried, the clock
duplicated the lock screen's and the charge meter was flavour; the bell became
the Alerts app plus a badge in the home header, and the aether meter became a
strip that appears in Messages only when no GM is connected — which is the same
condition that stops player-to-player messages being deliverable.

### Apps

| App | What it holds |
|---|---|
| **Student ID** | Portrait, cohort, student ID, editable status line, Year / primary currency / Gift, next event, dormitory, GM notes |
| **Messages** | 1-on-1 and group threads, day separators, grouped senders, per-thread mute, read receipts |
| **Contacts** | Visual-novel portrait grid by category, relationship gradient, history log, private notes |
| **Notices** | The school notice board — world-wide, dismissed per student |
| **Schedule** | The student's timetable |
| **Gift** | Gift name, level, description and a milestone track. The skill tree's data layer is in; the viewer is not — see below |
| **Bank** | A balance card per currency, over a ledger of what moved and why |
| **Notes** | Two notebooks — theirs and the party's. Really Foundry journals — see below |
| **Gallery** | Photo grid with a lightbox: download, share, or drop an image |
| **Camera** | Photographs the canvas as that player sees it, into their gallery |
| **Maps** | Shared maps with markers the GM reveals as the party finds them |
| **Alerts** | Every toast, logged — tap to jump to the app it came from, or dismiss one at a time |
| **Settings** | Device name, accent colour, skip-lock, reduce motion, clear the alert log |

### Personalisation

Each student picks an **accent** in Settings — Aether, Verdant, Ember, Amethyst,
Rose or Gold. It tints the stone on their bracelet and the whole projection, so
two scrolls open side by side on the table read as two different devices.

### Notes are journals

The Notes app stores nothing of its own. A notebook is a `JournalEntry`, found
by flag rather than by name, and each note is a page in it.

There are two, as a segmented control at the top of the app:

| Book | What it is |
|---|---|
| **Personal** | One entry per student, owned by whoever plays them |
| **Party** | One world-wide entry with `default: OWNER`, so everyone can write in it |

That ownership is the *entire* difference between them — the plumbing underneath
is identical, which is the argument for having built notes on journals at all. A
party note shows who wrote it last, resolved from the page's own
`_stats.lastModifiedBy`; a personal one doesn't, because there is only one
candidate. If you would rather the party could only read the shared book, drop
its ownership to Observer in the sidebar.

That is the whole design. It pops out because a journal already has a window. The
GM can read and annotate any student's notes from the sidebar because a journal
is already in the sidebar. Two open clients stay in step because Foundry syncs
documents. And it survives a Danger Zone wipe, because it was never scroll data.

Two things follow from it:

- **The GM's client issues the notebooks**, on ready. A player cannot reliably
  create a `JournalEntry` — that is a world permission, off by default — but a
  player who *owns* one can create, update and delete pages inside it. Until a
  GM has connected once, the app says so rather than breaking.
- **The scroll edits plain text; the journal edits anything.** A page carrying a
  table, a link or an embedded image is shown read-only in the scroll and points
  at the pop-out, because a plain-text save over it would flatten the formatting
  rather than fail.

### The camera

The Camera app photographs `canvas.stage` — the scene as *that client* renders
it, so a player's photo carries their own vision and fog with no filtering
needed, and the HTML on top (chat, sidebar, the scroll itself) is absent, which
is the photograph you wanted.

Storage is the awkward part. A viewport JPEG is a few hundred kilobytes, far too
much for an actor flag, so it becomes a file under `<gallery folder>/captures/`.
Foundry's upload permission is off for players by default, so unless you turn it
on, captures are relayed to the GM's client and written there — the same shape as
the message relay, and it needs a GM connected for the same reason.

**The darkroom.** That round trip takes an unknowable moment, so a relayed
capture appears in the gallery straight away as a *developing* tile — the
photograph itself, washed out, with a sweep across it. It resolves into the real
entry when the GM's client confirms, matched by a token the photographer's client
sends and the GM echoes back untouched, which is what takes the right tile out
when two are in flight. A failure stays put and marked until it is tapped away,
with the reason on it; ninety seconds of silence counts as one.

### Housekeeping

Taking an image out of a gallery leaves the file alone on purpose — the same
photo may be in three other galleries. Right per-image, wrong over a campaign.

**Command Center → Gallery → "Find captures nobody has in their gallery"** finds
what that decision left behind. It subtracts *everything* that points at an
image — galleries, **message attachments**, **map pins** and contact portraits —
from the folder listing, because a capture attached to a message is still on
screen even after the photographer tidied it out of their own gallery. The list
goes to the console as a table, and to a panel with a thumbnail and a checkbox
per file:

- **Keep** puts the checked files back into the right student's gallery — the
  actor id is in the filename, so a photo removed by mistake goes home.
- **Delete** hands over the exact commands. **Foundry's client API cannot delete
  a file** — `FilePicker` browses, uploads and makes directories, and no core
  version has ever offered more — so this prints a PowerShell script to the
  console and downloads it, to be run from your Foundry `Data` folder.

### Sharing images

| From | You can |
|---|---|
| Gallery lightbox | Download it, share it with any number of students, remove it |
| Message composer | Attach one of your own gallery images |
| Message lightbox | Download it, or save it into your own gallery |
| Command Center → Gallery | Push one image into **every** student's gallery at once |

A share lands in the recipient's gallery tagged with your name, raises an alert
and, if they're at the table, a toast. It goes through the GM relay, because a
player cannot write another player's flags — so it needs a GM connected.

Removing an image takes out the gallery entry, not the file: the same photo may
be in three other galleries.

### Maps

World content, like the notice board: one map, edited once, read by everyone.

A pin's position is stored as a **percentage** of the image rather than a pixel,
which is the whole trick — the same coordinates land correctly on a 480px panel
and in the lightbox, and there is nothing to recompute when anything resizes. The
GM places pins by clicking the preview in **Command Center → Maps**, and that
preview is the same image the students tap, so where you click is where they
look.

`found: false` is the field worth knowing about. An undiscovered pin is stored
but **stripped world-side before it ever reaches a player's client** — there is
nothing in the DOM for a curious player to read. A map can be handed out in
session one and still have somewhere to go in session nine. Reveal one mid-scene
with:

```js
await zs.revealPin("The Academy", "The vault");
```

An unpublished map behaves the same way: it does not leave the GM's screen.

A pin can carry a photo as well as a note — including a capture from the camera —
and the student can save that photo into their own gallery from the pin.

### The message queue

**Command Center → Queue.** Write messages before the session; send them on the
beat with a button.

Deliberately *not* scheduled against the world clock. A GM who has written the
session's beats wants them to land on the beat, not at a timestamp guessed the
night before. Nothing in the queue ever goes out on its own.

- Each entry has a sender name, the text, an optional image, and who gets it —
  **Everyone**, or a hand-picked list. "Everyone" is resolved at send time, so a
  student who joins later is included.
- Entries **stay after sending**, with a count and a "last sent" stamp, because
  the good ones get used again.
- Delivery is the same write `sendNPCMessage` does — a GM owns every actor, so
  there is no relay involved and no GM-connected caveat. Recipients get a toast.

```js
const id = await zs.queueMessage({ from: "Headmaster", text: "See me at once." });
await zs.sendQueued(id);
```

### Read receipts

One tick on a message you sent means it was written into their scroll. Two mean
they have opened the thread. In a group the count is what matters, so it says how
many.

A receipt has to reach the **sender's own copy** of the message, which lives in
their actor's flags and which the reader cannot write — so it goes through the GM
relay like everything else that crosses between students. Marks are matched on
`ts`, which the sender assigns and both copies therefore agree on.

Ticks appear **only on threads with another student in them**. An NPC has no
scroll and can never send a receipt back, so a tick that could never turn would
read as a delivery failure rather than as an absent feature.

### Gift trees

A Gift starts as one thing a student can do and grows into a tree: buffs to core
mechanics, and nodes that widen what the Gift can be pointed at.

**The module fixes the shape; the campaign writes the contents.** Nothing here
ships with node names or descriptions, and nothing generates them — that is
writing, not code. `zs.giftTreeTemplate()` returns the empty-but-valid shape, and
`zs.setGiftTree()` takes a filled one:

```js
{
  // Rows, drawn top to bottom. A node names one by its key.
  tiers: [
    { key: "root", label: "Awakening" },
    { key: "t1",   label: "" },
    { key: "t2",   label: "" },
    { key: "t3",   label: "" },
  ],

  nodes: [
    {
      id:          "n0",          // unique within this tree; requires[] points at it
      tier:        "root",        // which row
      name:        "",            // what it is called
      kind:        "milestone",   // "buff" | "freeform" | "milestone" | "capstone"
      cost:        0,             // points to take it; 0 for something given
      requires:    [],            // node ids that must be unlocked first — the edges
      description: "",            // the flavour: what it feels like to have
      effect:      "",            // the mechanics, kept separate so a sheet can read
                                  // one without the other
    },
  ],

  unlocked: [],   // node ids the student has taken
  points:   0,    // what they have left to spend
}
```

The four `kind`s exist so a renderer can draw them differently and a sheet can
filter them: **buff** sharpens something that already works, **freeform** widens
what the Gift may be pointed at, **milestone** is a story beat rather than a
purchase, and **capstone** ends a branch.

```js
zs.giftTree("Rin Adler");                            // read it, always well-shaped
await zs.setGiftTree("Rin Adler", tree);             // replace it
await zs.unlockGift("Rin Adler", "n1");              // take a node, by the rules
await zs.unlockGift("Rin Adler", "n1", {force: true}); // grant it regardless
```

`unlockGift` checks requirements and cost, spends the points, and raises an
alert. `force` skips both, which is what a GM granting something outside the
rules needs.

#### The library, and trees that compose

A tree lives in the **world library** rather than on the student who has it, so
a shared tree is edited once instead of once per student, and nobody's progress
is disturbed by the edit.

**A student is assigned a list of trees, not one.** Usually two: the Awakening
trunk everyone has, plus their own branch. Node ids are namespaced by their tree,
so a branch can hang off a chosen point on the trunk and the two draw as one
continuous board:

```js
await zs.saveGiftTree({
  id: "core", name: "Awakening",
  nodes: [{ id: "n1", name: "Reach", cost: 1, requires: [], x: 50, y: 20 }],
});
await zs.saveGiftTree({
  id: "ember", name: "The Ember Path",
  nodes: [{
    id: "e1", name: "Ember Fist", cost: 2,
    requires: ["core:n1"],          // ← the edge that joins branch to trunk
    x: 30, y: 50,
    grants: [{ uuid: "Compendium.pf2e.feats-srd.Item.XXXX", name: "Ember Fist" }],
  }],
});

await zs.assignGiftTrees("Rin Adler", ["core", "ember"]);
await zs.grantGiftPoints("Rin Adler", 3, "First bell");
```

`x` and `y` are a percentage of the board, not a pixel, so a node lands correctly
on the 480px panel and in the editor alike. `grants` are created on the actor
when the node is taken — and recorded by id, so a refund takes back exactly
those items.

```js
zs.giftTrees();                             // the library
zs.giftGraph("Rin Adler");                  // everything they can see, composed
zs.validateGift("ember");                   // cycles, dead edges, unreachable nodes
await zs.deadGifts("ember");                // grants whose UUID no longer resolves
await zs.refundGift("Rin", "e1", {preview: true});  // what would go with it
await zs.refundGift("Rin", "e1");           // and take it back, dependents too
await zs.resetGift("Rin Adler");            // everything back
```

A refund **cascades** to anything that depended on the node: a tree holding a
node whose prerequisite is gone is a corrupt tree. `preview` names the casualties
without writing anything.

A pre-v1.12 tree stored on an actor still works, and is lifted into the library
automatically the first time a GM loads the world.

#### The editor

**Command Center → Gift → Tree library.** Drag nodes where you want them; drag
from a node's link handle onto another to make it a prerequisite; click an edge
to remove it. A requirement crossing into another tree is picked from a list
instead, because the other tree is not on this board. Drop a feat or item from a
compendium onto the node to make it a grant. Type a points figure to see the
board as a student with that many would. The problems strip runs the same
validation `zs.validateGift()` does.

There is no save button — every edit writes straight to the library.

**Command Center → Gift → This student** is the other half: which trees they are
on, their points, what they have taken, a refund per node, and a full reset.

#### The student's side

The Gift app is the tree, panned by dragging and zoomed by wheel or the two
buttons. It opens framed on what they can afford right now rather than on the
root they took six sessions ago. Nodes are drawn in four states — taken,
affordable, locked by cost, locked by requirement — and the last two are
deliberately distinct, because "you cannot afford this" and "you have not earned
this" are different messages. Tapping a node raises a sheet with its description,
effect, grants, and either a Take button or the reason there is not one.

A student on no tree still sees the v1.8 milestone track.

### Exporting notes

**Command Center → Info → Export notes** writes a student's notebook out as
Markdown, or both books with a rule between them. The conversion is shallow on
purpose — headings, emphasis, links, list items, and everything else falls
through to plain text. The real content is always still in the journal; this is a
copy to read.

```js
zs.notesMarkdown("Rin Adler");          // their book
zs.notesMarkdown("Rin Adler", "party"); // the shared one
zs.notesMarkdown("Rin Adler", "all");   // both
```

---

## Install

**By manifest URL** (Foundry → Add-on Modules → Install Module):

```
https://github.com/Arcana127/ZenithModules/releases/latest/download/module.json
```

**By hand:** copy the `zenith-scroll/` folder into your Foundry `Data/modules/`
directory and restart.

---

## Settings

| Setting | Scope | Default | What it does |
|---|---|---|---|
| Gallery Image Folder | world | `scroll-gallery` | Default folder hint for gallery images |
| Player-to-Player Messaging | world | on | Gates the New Conversation button, the picker, the send path and the GM relay |
| Use Token Images | world | on | Draw the small circular avatars from token art rather than portraits |
| Marks Item Name | world | `marks` | Legacy. Superseded by the currency list, but still honoured if you renamed your Marks item before v1.8 |
| **Recentre the Scroll** | per user | — | A button, not a value. Puts the bracelet back in the middle of the screen |

Notices, the school calendar and the **currency list** are world content too, but
they're edited in the Command Center rather than this sheet.

### Losing the bracelet

The bracelet is draggable and remembers where you put it, on your own user flag
— so it is possible to park it under a docked sidebar, or on a monitor that is
no longer attached, and have nothing left to drag back.

Three ways out, all per-user:

- **Recentre the Scroll** in this settings sheet. Players get it too; it is not
  a GM button.
- **Shift+G**, registered as a proper keybinding, so it appears in *Configure
  Controls* and can be rebound if you have already spent that chord.
- `zs.recentreScroll()` from a macro.

It also can't happen by accident any more: the bracelet is clamped back inside
the viewport on load and on every window resize, so a position saved on a wide
monitor doesn't strand it on a narrow one.

### Currencies

The Bank app reads a world setting shaped like this, defaulting to Marks and
Astras:

```js
[
  { key: "marks",  itemName: "marks",  label: "Marks",  icon: "fa-coins", tint: "#e0c050", primary: true  },
  { key: "astras", itemName: "astras", label: "Astras", icon: "fa-star",  tint: "#a6f2fb", primary: false },
]
```

`itemName` must match an inventory item; the amount is read from its
`system.quantity`. A missing or renamed item reads 0 rather than erroring.
`primary` decides which balance the Student ID card shows — there is only room
for one there. Edit the list in the Command Center's **Bank** tab.

### Portraits

The four small circular avatars — home header, message avatars, contact grid and
the Student ID card — draw from each actor's **token** art, which is framed to be
recognisable at 46px in a way a full-body portrait is not.

The 96×118 contact detail portrait deliberately keeps `actor.img`. It is a tall
rectangle through `object-fit: cover`, so a square token loses its sides and any
ring baked into the token art gets cut through — and that panel is the one screen
where large character art earns its space.

Contacts *store* their portrait when they are added, so flipping the setting does
not reach entries already in the list. **Refresh Portraits** in the Command
Center's Rels tab (or `zs.refreshPortraits()`) brings them up to date.

---

## GM Command Center

Right-click the bracelet, or right-click an actor in the sidebar and choose
**Open in Scroll Command Center**.

Per-actor sections: Info, Schedule, Gift, Messages, Rels, Bank, Gallery.
World sections: **Notices** and **Calendar** — one list each, seen by everyone.
Plus **Danger**, below.

The actor directory context menu also offers **Add as Contact to All Students**.

### Danger Zone

GM-only, and in three deliberate steps: **export to JSON**, **set a passphrase**,
then **Clear All Scroll Data** — which needs the passphrase *and* the word
`DELETE`, and lists exactly what it is about to remove and from how many actors.
Flags are unset rather than emptied, so the actors come back genuinely clean.
World notices and the calendar are a separate checkbox, off by default.

Take the export. It is the only undo a clear has.

Be clear about what the passphrase is: **a misclick guard, not security.** It is
stored as a salted hash and never in plain text, because world settings sync to
every connected client — but anyone with GM rights and a browser console can
bypass the dialog entirely. What actually stops a player wiping the campaign is
Foundry's permission model: a player cannot write another actor's flags at all.
This stops *you* doing it by accident at 1am.

---

## Macro API

```js
const zs = game.modules.get("zenith-scroll").api;
```

**Yours, whoever you are** — no permissions involved, it moves your own bracelet:

```js
zs.recentreScroll();
```

**Per-student** (GM, or the actor's owner):

```js
await zs.sendNPCMessage("Rin Adler", "Prof. Hale", "See me after class.");
await zs.sendNPCMessageAll("Headmaster", "Assembly at first bell.");
await zs.adjustRelationship("Rin Adler", "Prof. Hale", +1, "Covered for her");
await zs.addGalleryImage("Rin Adler", "gallery/duel.webp", "The duel");
zs.gallery("Rin Adler");            // what is in it, newest first
zs.notebook("Rin Adler");           // their notes, as the JournalEntry it is
zs.partyNotebook();                 // the shared one
zs.notesMarkdown("Rin Adler", "all");  // both books, as Markdown
zs.giftTree("Rin Adler");           // their skill tree, always well-shaped
await zs.unlockGift("Rin Adler", "n1");

await zs.grant("Rin Adler", "astras", 50, "Tournament prize");
await zs.grant("Rin Adler", "marks", -12, "Replacement wand");   // negative is a charge
await zs.grantAll("marks", 25, "Term stipend");
zs.balances("Rin Adler");   // [{ key, label, amount, tint, icon, primary }, ...]
zs.ledger("Rin Adler");     // newest first
```

A grant moves the inventory item's quantity, appends a dated ledger line and
raises an alert. A balance never goes below zero, and a student with no currency
item yet gets one created rather than having the grant dropped on the floor.

**World** (GM only):

```js
await zs.postNotice("Duelling hall closed for repairs.");
await zs.setSchoolEvent("Second Examination", 3);   // 3 days out
await zs.advanceDay();                              // every event moves 1 closer
await zs.clearSchoolEvent("Second Examination");

await zs.addGalleryImageAll("gallery/party.webp", "The whole year, first term");
await zs.issueNotebooks();        // any student still without one
await zs.sweepCaptures();         // orphaned captures: list them, keep or delete
await zs.orphanCaptures();        // the same list, with no interface

const id = await zs.queueMessage({ from: "Headmaster", text: "See me at once." });
await zs.sendQueued(id);          // fire it on the beat
await zs.revealPin("The Academy", "The vault");
await zs.refreshPortraits();      // re-read stored contact portraits
const backup = zs.exportData();   // everything the module stores, as a plain object
```

`setEvent(actor, name, days)` and `setEventAll(name, days)` still work and
forward to `setSchoolEvent`; the actor argument is ignored, because the calendar
is shared.

---

## Architecture

`module.json` lists only `scripts/zenith-scroll.mjs`; everything else is pulled
in as relative ES imports, so adding a file needs no registration.

```
scripts/
  zenith-scroll.mjs   entry point: settings registration + hook wiring only
  core.mjs            constants, dependency-free helpers, the singleton registry
  world.mjs           world-scope content (notices, calendar) + the C1 migration
  data.mjs            actor-flag load/save, defaults, migrations, derived reads
  socket.mjs          GM relay (messages, shares, captures), toasts, availability
  notes.mjs           the journals behind the Notes app, personal and party
  capture.mjs         the camera: the viewport, the darkroom, and finding orphans
  sweep.mjs           the GM's keep-or-delete panel for orphaned captures
  ui-scroll.mjs       ScrollIcon + ScrollUI (the player-facing device)
  ui-gm.mjs           GMPanel (the Command Center)
  api.mjs             ZenithAPI (macro surface)
tests/
  smoke.mjs           node tests/smoke.mjs — 434 checks
  render-preview.mjs  builds a page of every view at three panel heights
```

Imports run one direction only, which is what keeps the module cycle-free:

```
core  <-  world  <-  data  <-  socket  <-  ui-scroll
  ^                    ^                       ^
  +--------------------+-- ui-gm, api ---------+---  zenith-scroll.mjs (entry)
```

`core.mjs` must keep importing nothing.

### Rules that bite if you break them

- **Save with nested object notation**, never a dot path:
  `actor.update({flags: {[M]: {[section]: data}}})`. Foundry's path parser
  misreads the hyphen in `zenith-scroll` and the write silently fails.
- **Read sections fresh at save time.** A render-time copy is stale by the time
  the user clicks Save.
- **`saveSection(..., {silent: true})` for anything that autosaves while the
  user is typing.** Without it the save rebuilds the field being typed into.
- **`esc()` everything player- or NPC-authored** that goes into `innerHTML`.
  The two deliberate exceptions are `academic.notes` and
  `academic.giftDescription`, both GM-only fields where HTML is intended.
- **Foundry ships Font Awesome Free.** Pro-only icons (`fa-grid-2` and friends)
  render as an empty box.
- **Name a type token, never a raw pixel size.** Every text size in the
  stylesheet reads `--zt-2xs` … `--zt-2xl`; the only surviving raw sizes are icon
  glyphs and line-heights, which are not type.
- **Nothing positioned to escape a scroller can be relied on to escape it.**
  `.zsu-scroller` clips on both axes and `.zsu-screen` clips on its rounded
  corners. Anything that has to break out — a tooltip, a popover — belongs on
  `<body>` at `position: fixed`, placed from the anchor's rect.
- **Reach the UI through the `app` registry** (`app.ui?.refresh()`), never by
  importing it — that would create a cycle. Slots are null until `ready`.
- **The *last* child of `.zsu-stage` is the live view.** Views are appended, so
  during a transition the outgoing one is second-to-last, not first. Anything
  further back is a leftover from a transition the next navigation interrupted
  and should be dropped, not animated. Reading `firstElementChild` here is what
  used to leave screens stacked on top of each other.
- **Anything that becomes an `src` gets `safeImageSrc()` first** if it arrived
  over the socket or out of another user's flags — at the relay *and* again at
  the point of render. `javascript:` is the attack; `data:` is refused
  separately, because it would be a megabyte of base64 in someone's actor flags.
- **A capture cannot live in a flag.** Flags sync to every connected client on
  every change; a viewport JPEG is hundreds of kilobytes. Images are paths.
- **Compare file paths decoded.** `FilePicker.browse` percent-encodes what it
  returns; a flag holds whatever was written into it. `a%20b.jpg` and `a b.jpg`
  are the same file and nothing else will tell you so.
- **Foundry cannot delete a file from the client.** Never write code that
  pretends otherwise — hand over the command instead.
- **Hide by not sending, not by not rendering.** An undiscovered map pin is
  stripped in `visibleMaps()` before it reaches a player's client. Anything a
  player is not meant to know must never arrive, because everything that arrives
  is readable from their console.
- **A receipt has to reach the sender's own copy** of the message, in their
  actor's flags, which the reader cannot write. Anything that crosses between
  two students goes through the GM relay.
- **Cancelling an animation cancels its `animationend` too.** Anything that
  cleans up on that event needs a timer behind it *and* a hand-settle path for
  when `.zs-calm` arrives mid-flight. `animationend` also bubbles, so check
  `e.target` before acting on it.

---

## Tests

```
node tests/smoke.mjs
```

434 checks. Foundry and the DOM are stubbed — including a journal layer and a
file picker whose folder listing the test controls, so the notes path and the
capture sweep are both covered — which gets data, world content, migrations, the
socket relay and its refusals, every render path (the GM tab list is driven off
`GM_TABS`, so a new tab cannot be added without being covered), and the
bookkeeping around the view transitions. Not covered: the animations themselves,
the drag handling, the dialog chrome, and the camera's own render, which needs a
GPU. Those still need a look in the real app.

Run it after moving code between files: a split turns a missing import into a
runtime error that `node --check` cannot see.

### Looking at it

```
node tests/render-preview.mjs
```

Writes `tests/preview.html`: every view, rendered through the real `ScrollUI`,
laid out at three panel heights and styled by the real stylesheet. Open it and
look — then resize.

**This is not optional for layout work.** The smoke suite renders views and
asserts *structure*, not geometry, and has nothing to say about anything being
clipped, off-centre or overlapping. Every layout bug fixed in v1.8 was found by
looking at a rendered page or measuring one; none of them showed up in the
tests.
