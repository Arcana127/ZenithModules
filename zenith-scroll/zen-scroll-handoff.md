Zenith Scroll - Project Handoff
What this is

Zenith Scroll is a custom Foundry VTT (v13) module built for a tabletop campaign called Zenith Academy Final. It works as an in-world magical device HUD for players, styled to look like a physical magitech scroll (teal, gold, and dark color palette, crosshatch screen texture, glowing crystal orb). Players open it to check their profile, class schedule, Gift progression, messages, relationships, and a photo gallery. The GM has a separate Command Center panel to edit all of that data behind the scenes.

Current version is v1.5. This module was built entirely across a series of Claude.ai chats, iterating version by version based on playtesting feedback. There is no existing Claude Code session for it, this is the first time it's moving into that workflow.

Core architecture
Single main script, a .mjs file, plus a CSS file (currently minified).
Data lives on actor flags in Foundry, split into namespaced sub-keys rather than one flat object: profile, academic, social, media, system. This split was a deliberate fix, an earlier flat-object version meant every save could clobber every other section.
Saving MUST use nested object notation when calling actor.update():
js
  actor.update({flags: {[MODULE]: {[section]: data}}})

Do not use dot-notation paths like flags.zenith-scroll.academic. Foundry's path parser misreads the hyphen in the module name and the write silently fails. This bit us once already (broke every save except cohort, which happened to be structured differently). Any new save logic should follow the nested object pattern.

Section data must be read fresh at save time, not captured in a render-time closure, or you'll write stale data back.
Player-to-player messaging runs through a socket relay where the GM client acts as the middleman, writing messages into the target actor's flags on their behalf.
Messaging uses proper conversation objects, not a flat sender-keyed array: from, to, participants, isGroup, and per-message sent/read fields. Threads always display the other person's name regardless of who sent the last message (iMessage-style).
Timestamps are automatic: checks for the SimpleCalendar module first, falls back to formatting game.time.worldTime as a 12-hour clock, and only shows "Now" as a last resort. The GM's NPC message form keeps a manual time field so I can backdate messages for narrative purposes.
Feature list (v1.5)
Draggable scroll icon, CSS-drawn (no image assets), with animated scanline boot sequence on open (currently 0.4s, was slowed down from 0.8s at my request)
Home tab: portrait, status line, cohort, student ID, Marks (academic currency), event countdown, announcements
Schedule tab
Gift progression tab
Messages tab: 1-on-1 and group conversations
Relationships tab: visual novel style portrait grid, grouped by category (Cohort, Faculty, Students, Other). Fellow player characters auto-populate into Cohort. Hovering a portrait shows a tooltip with name, title, relationship rank, and current status. Clicking slides in a detail panel with a large portrait (opens a lightbox), the full relationship gradient bar, an online/offline badge for players, a history log, and a personal notes textarea that autosaves after 800ms of no typing. Notes are private per player, stored on their own actor's social flags.
Gallery tab with lightbox
GM Command Center: edits everything above per-actor, plus right-click context menus to add actors as contacts, and "copy to all students" buttons for schedule, events, and announcements
Module settings: gallery image folder path, toggle for player-to-player messaging
Design language to keep consistent
Visual reference points are Persona and Fire Emblem support screens, whatever gets added should feel native to the existing scroll aesthetic, not bolted on.
Palette stays teal/gold/dark. Gemstone color has gone through a few passes (magenta to black to green) before settling.
Nothing should feel like a generic web app dropped into the device frame.
Known history / things not to reintroduce
The dot-notation save bug described above.
An earlier group chat bug: the GM relay was creating a brand new conversation on the recipient's side instead of matching on the existing convId, because participant name-to-ID mapping used game.actors.getName() inconsistently. This was fixed by having the relay match existing conversations by convId first before falling back to creating a new one, and by seeding a system message on group creation so empty groups aren't invisible.
Don't go back to a flat sender-keyed message array, the conversation object structure with participants/isGroup was a deliberate redesign.
How I like to work on this
I review and approve plans before implementation. If a change touches multiple systems or is ambiguous, lay out what you understand and any concerns first, and wait for a go-ahead rather than just diving in.
I give targeted feedback rather than accepting whole concepts as-is, expect iteration.
After bigger changes I like a summary of what changed and why, plain language is fine.

---

## v1.6 — Track A (V14 compatibility + bug pass)

Foundry V14 compatibility and correctness only. No design changes, no new features.
`module.json` is now `minimum: 13`, `verified: 14`. Pre-v1.6 files are in `_backup-v1.5/`.

### V14 compatibility
- **Context menu hook renamed.** `getActorDirectoryEntryContext` stopped firing in V13;
  it is now `getActorContextOptions` with signature `(application, menuItems)`, and entry
  callbacks receive a plain `HTMLElement` (read `dataset.entryId`), not jQuery. Both GM
  directory entries were silently dead before this. Do not put the old name back.
- Native `confirm()` replaced with `confirmDialog()`, which prefers
  `foundry.applications.api.DialogV2.confirm` and falls back to the browser dialog.

### New invariants — do not undo these
- **`saveSection(actor, section, data, {silent})`.** `silent:true` tags the update with
  `{zenithSilent:true}`; the `updateActor` hook checks it and skips the re-render.
  Use it for anything that autosaves while the user is typing (relationship notes,
  read receipts, student-ID assignment). Without it the save destroys the field being
  typed into. The hook now takes the full `(doc, changed, options, userId)` signature.
- **`this.relContact` on ScrollUI.** The contact detail panel is view state, not a tab,
  so it has to be re-resolvable after a re-render. `_contacts(d)` builds the categorised
  list; `_relationships` delegates to `_relDetail` when `relContact` is set. Previously
  the notes autosave bounced you back to the portrait grid mid-sentence.
- **Messages carry `ts` (a real `Date.now()`) as well as `time`.** `time` stays the
  display string, so the GM can still backdate narrative messages; `ts` is what the
  conversation list sorts on. Messages written before v1.6 have no `ts` and fall back to
  reverse creation order — this self-heals as threads get used. Every write path sets it.
- **Announcements have stable `id`s.** Dismissals key off `a.id`, falling back to array
  index for pre-v1.6 entries. Never go back to storing dismissals as bare indices —
  adding or deleting one announcement shifted everyone's dismissals onto the wrong rows.
  `withIds()` in the GM panel backfills ids *in place*, so repeated saves reuse the same id.
- **`esc()` on anything user- or NPC-authored going into `innerHTML`.** Deliberate
  exceptions, both GM-only long-form fields where HTML is intended: `academic.notes`
  and `academic.giftDescription`.

### Behaviour fixes
- Conversation list sorts by actual last-message time (the old comparator computed the
  last messages and then ignored them, sorting by reverse creation order instead).
- Freshly created conversations with no messages are listed instead of vanishing.
- `enablePlayerMessaging` is now actually read — it gates the New Conversation button,
  the picker, the send path, and the GM relay. It was previously a decorative toggle.
- Sending to another player checks that a GM is actually connected, and refuses with a
  warning rather than writing a message locally that will never be delivered.
- The GM relay verifies the sender owns the actor they claim to be, and copies only known
  fields off the wire instead of spreading the payload into actor flags.
- Group chat creation puts every member on the same `convId`, adopting an existing group
  of that name if one exists. This also repairs groups already split by the old
  skip-if-present behaviour.
- Toasts stack (up to 3) instead of each one deleting the last.
- Status editor: clicking into the field no longer wipes it, and Enter no longer saves twice.
- `loadAll` only auto-assigns a student ID if the user actually owns the actor, and does
  it silently.

### Tests
`node tests/smoke.mjs` — stubs Foundry and the DOM, runs 31 checks over the changed
paths. All 7 of the shared behavioural checks fail against `_backup-v1.5/` and pass
against current, so they do bite. Run it after refactoring.

### Still open (deliberately out of Track A scope)
- Contacts, conversation participants and portrait lookups are still keyed by actor
  **name**; renaming an actor detaches all of it.
- The UI still fully re-renders on any non-silent actor update, so a GM save can still
  cost a player their scroll position and any text typed since the last autosave.
- Image paths are still typed by hand — no FilePicker.
- Conversations are still duplicated per-actor rather than stored once.


---

## v1.6 — Track B (restructure)

Formatting and file layout only. No behaviour changes, no design changes.

### File layout

`module.json` still lists only `scripts/zenith-scroll.mjs`; the rest are pulled
in as relative ES imports, so there is nothing to register when adding a file.

```
scripts/
  zenith-scroll.mjs   entry point: settings registration + hook wiring only
  core.mjs            constants, dependency-free helpers, the singleton registry
  data.mjs            actor-flag load/save, defaults, migration, derived reads
  socket.mjs          GM message relay, toasts, messaging availability
  ui-scroll.mjs       ScrollIcon + ScrollUI (the player-facing scroll)
  ui-gm.mjs           GMPanel (the Command Center)
  api.mjs             ZenithAPI (macro surface)
tests/
  smoke.mjs           node tests/smoke.mjs — 64 checks
```

Imports run one direction only, which is what keeps the module cycle-free:

```
core  <-  data  <-  socket  <-  ui-scroll
  ^         ^                       ^
  +---------+-- ui-gm, api ---------+---  zenith-scroll.mjs (entry)
```

`core.mjs` must keep importing nothing. If a helper needs `game` or an actor it
belongs in `data.mjs`, not here.

### The singleton registry

`scrollIcon` / `scrollUI` / `gmPanel` were module-level `let` bindings. They are
now `app.icon` / `app.ui` / `app.gm`, exported from `core.mjs` and assigned during
the `ready` hook. This is deliberate: `socket.mjs` and `api.mjs` need to nudge the
interface, and importing the UI directly would create a cycle. Always call through
`app`, and always with optional chaining (`app.ui?.refresh()`), since the slots are
null until `ready` fires.

Note the collision this creates: the `getActorContextOptions` hook's first
parameter used to be named `app`. It is now `_directory`. Don't name a local
`app` in any file that imports the registry — `tests/smoke.mjs` checks for this.

### Stylesheet

`styles/zenith-scroll.css` went from 102 minified lines to 2152 readable ones,
in 13 numbered sections following the class prefixes (`zsi-` icon, `zsu-` frame,
`zsh-` home, and so on — the header comment lists them all).

**Rule order is unchanged and every declaration is reproduced verbatim**, so the
cascade is identical to the minified build. Nothing was reordered, merged, or
deduplicated: the expansion was done by a parser that compared canonical rule
trees before and after, and all 256 non-toast rules were verified byte-identical
in content and order against `_backup-v1.5/zenith-scroll.css`.

That means the known cruft is still there, untouched and deliberate — `.zsm-broadcasts`
no longer matches anything the JS emits, and the z-index ladder is ad hoc. Cleaning
those up is a separate pass, because it changes computed values and wants a visual check.

### Tests

`node tests/smoke.mjs` now covers 64 checks: the Track A behaviour, plus every
player tab and every GM section rendering without throwing, the macro API, and
the socket relay including its refusal paths. The render checks exist specifically
because a split turns a missing import into a runtime error that `node --check`
cannot see — run them after moving code between files.


---

# Roadmap — Tracks C, D and E

Everything below is proposal, not settled work. Items marked **[confirmed]** are
things verified in the current code; the rest are design suggestions to argue with.
Nothing here has been started.

---

## 0. Design intent — read this first

The device wants to be a phone, and about half of that is already built. What
exists that is already phone-shaped:

- a tab bar of six icons along the bottom of the screen
- an unread **badge** on the app icon, and **toasts** that behave like push notifications
- a **boot sequence** (scanline sweep) when it powers on
- **Messages** laid out as iMessage — bubbles, sides, per-thread avatars
- **Contacts** with portraits, presence dots, and per-person detail pages
- **Gallery** as a photo grid with a lightbox

So the metaphor is established. Where it stops short is mostly the *shell* around
those apps, not the apps themselves.

### The proportion problem  **[confirmed]**

The icon (`.zsi-device`) is **52 × 110** — a tall handheld slab. The screen it
opens (`.zsu-frame` / `.zsu-screen`) is **720 × 680** — very nearly square, and
landscape-ish in feel. The thing you tap and the thing you get don't look like the
same object.

Three coherent ways out, and this choice drives most of Track E:

1. **Commit to portrait.** Make the open screen roughly 420 × 760. Everything
   already reads as a phone; the tab bar, thread list and contact grid all suit a
   narrow column better than a wide one. Biggest visual change, best payoff.
2. **Commit to "it unfolds."** Keep the wide screen but justify it — an opening
   animation where the slab expands into a reading surface, and a hinge or seam in
   the frame art. In-genre for magitech, and no layout rework.
3. **Leave it.** It's a scroll that projects a screen; nobody has complained.

I'd push for (1), but it's a taste call and it's yours.

### Where the phone metaphor is unfinished

| Phone affordance | Status |
|---|---|
| Home screen / app grid | Missing — the six tabs are hardcoded in `TABS`, and a seventh will crowd the bar |
| Lock screen | Missing — boot goes straight to Home |
| Notification centre / history | Missing — toasts vanish with no record |
| Per-app badges | Only Messages has one |
| Presence / Do Not Disturb | `statusPreset` is stored and **never read** **[confirmed]** |
| Mute a conversation | `muted` is stored and **never read** **[confirmed]** |
| Settings app | Missing — players can configure nothing |
| Personalisation (wallpaper, accent) | Missing — every student's device is identical |
| Sound | None at all — no chime, no boot tone, no UI clicks |
| Status bar (clock, signal, battery) | Missing — pure flavour, but very cheap and very phone |

### The Marks problem  **[confirmed]**

`getMarks()` reads an inventory item named "marks" and the Home tab displays the
number. Nothing anywhere spends, awards, or writes it. It is a currency with no
surface. Either give it one (a store app, a requisition form, an exam-fee sink) or
demote it from a headline stat — right now it's a number that only ever goes up
when you edit the sheet by hand.

---

## Track C — Data model

The single biggest smell: **world-level content is copied into every actor.**
Announcements, schedule and the next event all live in each student's flags, pushed
out by "copy to all" buttons. Edit an announcement afterwards and every player keeps
a stale copy until you push again.

- **C1. Split world content from personal state.** World-level: announcements,
  the school calendar, shared events, the NPC roster, schedule templates.
  Actor-level: my messages, my notes, my relationship ranks, my gallery, my
  dismissals. World content moves to a world-scope setting (or a dedicated Journal),
  and the "copy to all" buttons disappear because there is nothing to copy.
  *This kills a whole class of drift and makes the GM panel much smaller.*
  **Recommended first.**

- **C2. Key contacts and conversations by UUID, not name.** Today
  `game.actors.getName(...)`, `rel.name === ...` and `participants: [nameA, nameB]`
  mean renaming an actor detaches their conversations, portrait lookups and
  relationship entry all at once. Store `uuid` with `name` as a display fallback,
  and migrate existing data by resolving current names once.

- **C3. Decide where conversations actually live.** Each participant currently
  holds their own copy of a thread, so a group chat stores the same message N
  times and can drift. Options: keep per-actor copies (status quo, needs the relay),
  or move to one shared store with a mailbox Journal that players have write access
  to. Worth noting the constraint: **players cannot write world settings or other
  actors' flags**, so some relay or shared-permission document is unavoidable in
  Foundry. This one needs a real decision before it's built.

- **C4. Backfill `ts` on pre-1.6 messages.** They currently sort by reverse
  creation order. A migration could infer an order and stamp them so the thread
  list is correct everywhere, not just going forward.

- **C5. Make the Marks item name configurable.** `getMarks` hardcodes the string
  `"marks"` **[confirmed]**; a world setting would survive a rename or a system change.

- **C6. Schema version flag.** There's a v7→v1.5 migration and now implicit 1.5→1.6
  behaviour, with no stored version number. Add one so future migrations can be
  targeted instead of inferred.

---

## Track D — Render architecture

`ScrollUI.render()` tears down and rebuilds the entire DOM on every state change,
which is why Track A needed the `{silent: true}` escape hatch at all.

- **D1. Targeted updates.** Re-render the affected region rather than the whole
  scroll. Removes the need for `silent`, and fixes the remaining known issue: a GM
  save still costs a player their scroll position and any text typed since the last
  autosave.
- **D2. Preserve in-flight input.** Even with D1, any re-render of a region
  containing a focused field should restore value, selection and scroll offset.
- **D3. Tab transitions.** Instant swaps are the least device-like thing about it.
  A slide or crossfade between tabs, and a push/pop for thread and contact detail,
  would do more for "this is a real device" than any single feature.
- **D4. Virtualise long message lists.** Not urgent, but a thread with hundreds of
  messages rebuilds every node on every render today.
- **D5. Consider ApplicationV2.** Optional. It would bring window management,
  keybindings and Foundry's own lifecycle. The counter-argument is real: the whole
  point is that this does *not* look like a Foundry window, and AppV2 is only
  *required* by v16. Low priority, listed for completeness.

---

## Track E — Features and design

### E1. The shell (highest payoff for the phone feel)

- **Home screen with an app grid**, replacing the fixed six-tab bar. Lets apps be
  added without crowding, and gives the device a "place" to return to.
- **Lock screen** on open: time, date, next event, notification count, the
  student's chosen wallpaper. Tap to enter. This is where the boot animation belongs.
- **Status bar** across the top of the screen: clock (already have `getAutoTime`),
  a signal/aether meter, a charge meter. Flavour, but it sells the object.
- **Notification centre**: a pull-down list of what you've missed, since toasts
  currently vanish forever.
- **Resolve the proportion problem** per section 0.

### E2. Messages

- **Attachments from the player side** — send an image, not just receive one.
- **Wire up `muted`** — it's already stored **[confirmed]**.
- **Day separators and grouped timestamps** instead of a time on every bubble.
- **Delete / leave a conversation.** No way to do either right now.
- **Typing indicator and read receipts.** Both are achievable over the existing
  socket and both are strong for player-to-player scenes.
- **Search** across threads.
- **Queue undelivered messages.** Track A made a GM-offline send fail loudly;
  the better answer is to queue and flush when a GM connects.

### E3. Relationships

This is the strongest screen already. Extensions in keeping with it:

- **Rank-up moments** — an animated confidant-style card when a rank changes,
  rather than the number quietly moving.
- **Per-contact tags** (Cohort, Rival, Mentor, Secret) beyond the four categories.
- **Locked / unknown contacts** shown as silhouettes before you've met them.
- **A relationship web view** — who knows whom — for a campaign this social.

### E4. New apps

- **Bulletin board / school feed** — the natural home for announcements once C1
  makes them world-level, and much better than the current dismissible strip.
- **Calendar** — the schedule tab is a static list; a week view with the next
  event marked would earn its place.
- **Store / requisition** — gives Marks somewhere to go (see section 0).
- **Notes / journal** — the GM-authored `notes` HTML field is currently a hack
  bolted onto Home. A real notes app, player-writable, is more useful.
- **Map** — campus map with pins.
- **Exam / progression tracker** — the Gift tab covers one axis; grades and
  standing are the obvious second.

### E5. Personalisation

Each student's device is currently identical. A phone is personal.

- **Wallpaper** per student, picked by the player.
- **Accent / gem colour** per student — the palette already tokenises this
  (`--zd-gem`, `--zd-cyan`), so it's a small change with a large characterisation payoff.
- **Custom device name** ("Rin's Scroll").
- **Ringtone / notification chime** per contact — very Persona.

### E6. Sound

There is **no audio at all**. For a device that boots, buzzes and receives
messages, this is the largest single gap between what it is and what it's imitating.
A boot tone, a message chime, a soft UI click and a rank-up sting would be four
files and a volume setting.

### E7. GM tooling

The handoff says nothing should feel like a generic web app dropped into the
device frame. **The Command Center is exactly that** — it's a plain stack of form
rows. It's also the screen you personally use most.

- Restyle it to match the device language, or deliberately style it as the
  "administrator's terminal" — a different but intentional aesthetic.
- **FilePicker for image paths.** Portraits, gallery images and message
  attachments are all typed by hand today; `galleryFolder` is registered as a
  setting but only ever printed as a hint string **[confirmed]**.
- **Preview as player** — see a student's scroll exactly as they do.
- **Scheduled / triggered messages** — queue an NPC message to arrive on a later
  in-game day.
- **Bulk relationship editing** across all students at once.
- **Undo** for the "copy to all" buttons, which are currently irreversible.

---

## Cross-cutting

### Accessibility  **[confirmed — none of this exists]**

- **Zero `aria-*`, `role` or `tabindex` attributes anywhere in the module.** The
  whole interface is unreachable by keyboard and opaque to a screen reader.
- **`outline: none` appears 5 times with no `:focus-visible` replacement**, which
  actively removes keyboard focus rings from inputs.
- **No `prefers-reduced-motion` guard**, and there are **11 animations** including
  an infinite one (the orb glow, `zsorbglow 3s infinite`). This is the cheapest
  meaningful fix on the list — one media query.
- Tab buttons are `<button>` (good) but carry only a `title`, no accessible label.

### Responsiveness

`.zsu-frame` is `720px / max-width: 94vw` and the screen `680px / max-height: 72vh`,
so it clamps to the viewport but **there are zero `@media` queries** — the layout
inside never reflows. On a laptop screen the content just gets squeezed.

### Housekeeping

- **No localization.** Every string is hardcoded. Only worth doing if the module
  is ever shared beyond your table.
- **`.zsm-broadcasts` is orphaned CSS** — nothing in the JS emits it. Left in place
  deliberately during Track B; safe to delete.
- **The z-index ladder is ad hoc** (0,1,2,3,5,10,20,90,200,210,250,300). The icon
  at 90 sits *below* Foundry windows, so an open sheet covers it.
- **Two fonts are loaded; the mono one is used exactly once** **[confirmed]**.
  Either lean into it for device-readout text or drop it and save the request.

---

## Repo hygiene — worth doing as part of the first push

- **`README.md`** — what it is, screenshots, install, the macro API.
- **`LICENSE`** — even a private repo benefits from an explicit one.
- **`.gitignore`** — `_backup-v1.5/` probably shouldn't be tracked long-term.
- **`CHANGELOG.md`** — v1.5 → v1.6 is already documented in this file and could
  seed it.
- **`module.json` repo fields** — `url`, `manifest`, `download`, `readme`, `bugs`.
  These are what enable install-and-update by manifest URL rather than copying
  folders around, which matters as soon as anyone else runs your world.
- **A release workflow** — tag, zip, attach, publish. Optional, but it makes
  `download` actually work.

---

## Suggested order

1. **Repo hygiene** — you're pushing now anyway, and `module.json` metadata is
   easiest to add before the first tag.
2. **C1** (split world content from personal state) — removes a class of drift and
   shrinks the GM panel. Everything in E4 wants this done first.
3. **The proportion decision** from section 0 — it gates most of E1, so make the
   call before building shell features.
4. **E1** (shell: home screen, lock screen, status bar, notification centre) — the
   biggest jump in "this is a device", and the most visible to players.
5. **D1 + D3** together — targeted rendering and tab transitions are the same
   surgery, and D1 removes the `silent` workaround.
6. **C2** (UUID keying) before the contact list grows any further.
7. **E6** (sound) — small, self-contained, disproportionate payoff. Can slot in anywhere.
8. Accessibility's reduced-motion guard — ten minutes, do it whenever.

The rest of E is a menu to pull from once the shell is settled.
