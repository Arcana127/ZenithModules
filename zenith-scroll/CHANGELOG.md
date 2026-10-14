# Changelog

## 1.12.0 — The Gift is a tree now

A Gift was a name, a level and a list of milestones the GM ticked off. It is a
tree the student moves through themselves: multiple paths, points they spend,
and nodes that hand over real items when taken.

One thing still wants doing in a live world rather than a test: see **PF2e
grants** at the end.

### What a student sees

The Gift app is the tree, panned and zoomed. It opens framed on **the frontier**
— what they can afford right now — rather than on the root they took six
sessions ago, because a tree is opened to decide something and the decision is
always at the edge of what has been taken.

**Four node states, drawn four ways.** Taken, affordable, locked by cost, locked
by requirement. The last two are deliberately not the same grey: *you cannot
afford this yet* and *you have not earned the right to this* are different
messages, and a tree that conflates them reads as arbitrary. An edge lights only
when both its ends are taken, so a finished path reads as a path rather than as
a diagram of one.

Tapping a node raises a sheet over the board — kind, description, effect, what it
grants, and either a Take button or the reason there isn't one. A node locked by
requirement **names what it needs first**; "locked" without saying by what is the
most annoying thing a skill tree can do. Taking a node is behind a confirm that
says what it costs and what it hands over.

The sheet sits over the board rather than replacing it, because the decision is
about where the node sits in the tree, and taking the tree away to describe one
node throws that away.

A student on no tree still gets the v1.8 milestone track, which is the right
answer for a campaign that never builds one.

### What the GM does — Command Center → Gift → Tree library

Maps set the precedent in v1.11: you place a pin by clicking the actual preview,
because typing two percentages and reloading is not a workflow.

- **Nodes are dragged where you want them**, snapped to a grid by default.
- **An edge is dragged from one node onto another** by its link handle, and
  removed by clicking the line. The arrow runs prerequisite → dependent, because
  a tree with ambiguous edges is unreadable.
- **A requirement that crosses into another tree** cannot be dragged — the trunk
  is not on the branch's board — so it is picked from a list of every node in
  every other tree instead.
- **Grants are drag-and-drop.** Drop a feat or item from a compendium or the
  sidebar onto the node; its name and image are cached beside the UUID so the
  grant can be named later even if the pack goes away.
- **Preview as a student with N points**, which repaints the board in the states
  a student would see.
- **The problems strip** runs the same validation the test suite does, and each
  problem is a button that selects the node it is about.

Two things the board does that are worth naming. Every edit **writes straight to
the library** — there is no save button, because a board with unsaved state
loses work every time the tab is switched, and the tab is switched constantly
while a tree is being authored. And the node coordinate space is **inset by half
a node**: a node is centred on its own percentage and carries a handle below it,
so a node at 0% would have half of itself clipped by the board's own rounded
border. The inset leaves 0–100 meaning exactly what it means on the device.

The tab also has a per-student half: which trees they are on, their points, what
they have taken, and a refund control per node that names the dependents it would
take with it before it does.

### PF2e grants — the part that still needs your world

Granting works and is tested against a stubbed compendium. Three things could
not be checked without a running PF2e client, and are worth five minutes before
a tree is authored in bulk:

- whether a feat created with no `system.location` files itself sensibly;
- whether a granted item's rule elements behave as they would if the feat were
  dragged on by hand;
- whether an item carrying a **ChoiceSet** opens a dialog on creation, and what
  cancelling it does. The unlock already creates the items **before** spending
  the points for exactly this reason, so a cancelled dialog should not cost a
  student anything — but that ordering wants confirming rather than trusting.

### Also

- The preview renderer's copy of the Command Center tab list was stale — it had
  silently stopped covering Maps and Queue since v1.11. It imports `GM_TABS` now,
  so it cannot drift again, and it draws the tree editor with a real tree in it.
- Both fake DOMs learned `createElementNS`, without which the editor's SVG edges
  could not be rendered or asserted on at all, and learned to mirror a `class`
  attribute onto `className` the way a real element does.

### A tree is world content now, and a student is on a list of them

Before this, a student's whole tree — every node, name, cost and edge — lived on
their own actor flag. One shared tree therefore existed as six independent
copies: fixing a typo was six writes, each of which had to preserve whatever
that student had already spent.

The tree *body* moved to the world library, beside notices, maps and the queue.
What stays on the actor is only what is personal: the nodes they have taken, the
points they have left, and which trees they are on.

**A student is assigned a list of trees, not one.** That is the whole point. The
shared Awakening trunk everyone has and the personal branch assigned to them are
two trees in the library, composed into one graph. Node ids are namespaced by
their tree — `core:n4`, `emberpath:n1` — so a branch's root can name a trunk
node in its `requires` and grow out of a chosen point on it. The student never
perceives two trees; they perceive one tree that goes personal partway up.

A student who should be wholly unique is simply assigned a tree of their own.

### Points, and taking things back

One pool, spent anywhere the student has access to, so going deep on the trunk
instead of racing into the branch is a real decision. `zs.grantGiftPoints()`
issues them.

Undo is GM-only, and **cascades**: refunding a node takes back everything that
depended on it, because a tree holding a node whose prerequisite is gone is a
corrupt tree and silently allowing it is worse than refusing. `{preview: true}`
names what would go without writing anything, which is what a confirmation is
built from.

### Grants

A node can carry items it hands over when it is taken, by UUID. The student owns
their own actor, so the create needs no GM relay.

Two details that are not incidental. **The items are created before the points
are spent** — a PF2e item carrying a ChoiceSet opens a dialog on creation, and a
student who cancels that dialog must not already have been charged. And **a UUID
that no longer resolves does not block the unlock**: the node is taken, the
points are spent, the failure is reported. A tree can outlive the pack it
pointed at, and that is the GM's problem to fix, not a reason to refuse a
student something they earned.

What an unlock created is recorded by id, so a refund removes exactly those
items rather than guessing by name.

### Validation

Cycles, edges pointing at nodes that do not exist, duplicate ids, and nodes no
legal sequence of unlocks can ever reach. Logic rather than a rendering detail,
so the editor's strip and the test suite read the same answers. A branch is
validated against the whole library, or its edge into the trunk would read as
dangling.

### The old shape still works

A v1.11 tree stored on an actor goes on rendering, composed as a reserved local
pseudo-tree, and the v1.11 test block is kept verbatim as the contract that says
so. A GM-only migration lifts such a tree into the library — one tree per
student, never merged, because two students holding trees that share node ids
are not holding the same tree. `SCHEMA_VERSION` → 3.

### Tests

513 checks, up from 434 — the composition, the migration, the cascade refund,
the grant that cannot be found, the validation cases, the editor board, and the
student's four node states. Two of those needed the coverage loops widened: the
editor is a second pane behind a tab the GM loop already thought it had covered,
and the app loop renders every app but never its in-app states, so the node
sheet was invisible to it.

## 1.11.0 — Maps, a queue, read receipts, and a broom that actually sweeps

### The broom was wrong, and is now right

Answering the question directly: the detection half worked, but it was looking in
one place when there are four.

`findOrphanCaptures` subtracted only what the **galleries** pointed at. A capture
attached to a message and then tidied out of the photographer's own gallery would
have been reported as an orphan **while the message was still rendering it** — and
the delete script would have taken it. Contact portraits and, as of this version,
map pins had the same hole.

`referencedImages()` in data.mjs is now the single answer to "what points at an
image", and covers galleries, message attachments, contact portraits and map
pins. The sweep subtracts that.

What was already right and stays right: paths compared decoded, the GM gate, a
missing folder reported as "nothing to do" rather than as a fault, **Keep**
putting a file back into the gallery of the student named in its filename, and
**Delete** handing over the commands because Foundry's client API cannot remove
a file and never could.

### Maps

A new app, and world content like the notice board: one map, edited once, read by
everyone.

- **Pins are stored as a percentage of the image**, not a pixel. The same
  coordinates land correctly on a 480px panel and in the lightbox, and nothing
  needs recomputing when anything resizes.
- **The GM places them by clicking the preview** in Command Center → Maps, and
  that preview is the same image the students tap. Typing two percentages and
  reloading to see where they landed is not a workflow.
- **An undiscovered pin never reaches a player's client at all.** It is stripped
  in `visibleMaps()`, world-side — not hidden with CSS, not filtered in the
  renderer. There is nothing in the DOM for a curious player to read, which is
  the only version of "hidden" worth having. Same for an unpublished map.
- `zs.revealPin("The Academy", "The vault")` for the moment they find it.
- A pin can carry a photo as well as a note — a capture from the camera, say —
  and the student can save that photo into their own gallery from the pin.

### A queue, not a schedule

Messages written before the session and fired on the beat, from **Command
Center → Queue**.

Deliberately not scheduled against the world clock: a GM who has written the
session's beats wants them to land *on the beat*, not at a timestamp guessed the
night before. Nothing in the queue ever goes out on its own.

- Sender name, text, optional image, and who gets it — everyone or a hand-picked
  list. "Everyone" resolves at send time, so a student who joins later is in it.
- **Entries stay after sending**, with a count and a last-sent stamp. The good
  ones get used again.
- Delivery is the same write `sendNPCMessage` does — a GM owns every actor, so
  no relay and no GM-connected caveat — plus a ping so recipients get a toast
  rather than a silent arrival.

### Read receipts

One tick: written into their scroll. Two: they have opened the thread. In a group,
how many of them have.

The interesting part is where the receipt has to land. Marking a message read
happens in the *reader's* copy, in their own flags; the sender's copy is a
different document that the reader cannot write. So a receipt goes through the GM
relay like everything else that crosses between students, and is matched on `ts`
— assigned by the sender, so both copies agree on it.

Ticks appear **only on threads with another student in them**. An NPC has no
scroll and can never send a receipt back, so a tick that could never turn would
read as a delivery failure rather than as an absent feature.

### Gift trees — the shape, not the contents

A Gift is a starting point that grows into a tree. The data layer for that is
in, finished and tested; **the viewer is not, and nothing here ships with node
names or descriptions.** That is campaign writing, not module code.

`defaultGiftTree()` fixes the shape — tiers, nodes with `requires` edges, four
node `kind`s, unlocked ids and points — and `getGiftTree` defends whatever is
stored into it, because this is the one section expected to be written from
outside the module. `unlockGiftNode` checks requirements and cost, spends the
points and raises an alert; `{force: true}` skips both, which is what a GM
granting something outside the rules needs.

The README carries the worked shape. Generate trees against it now: it will not
change under you, and the app will read exactly this when it lands.

### Exporting notes

**Command Center → Info → Export notes** writes a notebook out as Markdown, or
both books with a rule between them. Shallow on purpose — headings, emphasis,
links, list items, and everything else falls through to text. The real content is
always still in the journal.

### Also

- The GM Command Center's tab list is exported, and the coverage test is driven
  off it — a new tab can no longer be added without a render test for it.
- New on the macro API: `queued`, `sendQueued`, `queueMessage`, `maps`,
  `revealPin`, `notesMarkdown`, `giftTreeTemplate`, `giftTree`, `setGiftTree`,
  `unlockGift`.

### Tests

434 checks, up from 374, including the four-way reference sweep, pin clamping,
the visibility strip, queue targeting and both of its refusals, receipt
verification and de-duplication, the whole gift-tree gate, and the Markdown
conversion.

## 1.10.0 — A party notebook, a darkroom, and a broom

### Notes has two books now

**Personal** and **Party**, as a segmented control at the top of the app, each
with a count on it. Tapping between them is instant; the note you had open
closes, because a note from the other book would be the wrong note.

The only difference between the two books is who owns the `JournalEntry` behind
each. A personal notebook is owned by whoever plays that student; the party
notebook is one world-wide entry with `default: OWNER`, so everyone can write in
it and everyone reads the same page. That is the entire implementation — the
plumbing underneath is identical, which is the argument for having built notes
on journals in the first place.

- **A party note says who wrote it last**, in the list and again above the
  editor, resolved from the page's own `_stats.lastModifiedBy`. A personal note
  doesn't, because there is only one candidate.
- **Deleting a party note warns that everyone loses it**, which a personal one
  has no reason to say.
- **Both pop out**, to their own journal window, and both are reachable from the
  Command Center's Info tab.
- If you would rather the party could only *read* the shared book, drop its
  ownership to Observer in the sidebar. Nothing here fights you for it.

### Photos develop where you can see them

A relayed capture goes to the GM's client, gets written, and comes back some
unknowable number of milliseconds later. Until now that gap looked like nothing
happening.

- **The photo appears in the gallery immediately, developing.** The tile is the
  photograph itself — washed out, desaturated, with a slow sweep across it —
  because it is already in memory and a grey box would be a worse placeholder
  than the real thing.
- **It resolves into the real entry when the GM's client confirms.** The
  photographer's client sends a token with the request; the GM echoes it back
  untouched, which is what takes the *right* tile out of the darkroom when two
  are in flight at once.
- **A failure stays put, marked, until it is tapped away.** A photo that
  silently vanished would be worse than one that says it didn't make it, and the
  reason the GM's client gave is on the tile.
- **Ninety seconds with no answer counts as a failure.** The gallery repaints
  itself every five seconds while something is genuinely out, and stops the
  moment nothing is — that timer is the only thing on the screen that ticks.
- The Camera app says how many are still out, so you don't have to go and look.

### The broom

Taking an image out of a gallery leaves the file alone on purpose: the same
photo may be in three other galleries. Right per-image, wrong over a campaign.

**Command Center → Gallery → "Find captures nobody has in their gallery"** now
finds what that decision left behind.

- **The list goes to the console**, as a `console.table` of filename, the
  student it was taken for, and the path. That is the part that survives closing
  the panel, and forty rows read far better there than in a 480px column.
- **And to a panel**, with a thumbnail and a checkbox each, so the choice is
  per-file rather than all-or-nothing.
- **Keep** puts the checked files back into the right student's gallery. The
  actor id is in the filename, so a photo removed by mistake goes home.
- **Delete** hands over the exact commands. This is the honest part:
  **Foundry's client API cannot delete a file** — `FilePicker` browses, uploads
  and makes directories, and no core version has ever offered more. So the
  button prints a PowerShell script to the console and downloads it, to be run
  from your Foundry `Data` folder. A delete button would have had to do the same
  thing with more ceremony.
- Comparison is on *decoded* paths. `FilePicker.browse` percent-encodes what it
  returns and a flag holds whatever was written into it, so `a%20b.jpg` and
  `a b.jpg` would otherwise never have been recognised as the same file — and
  every capture with a space in its path would have been reported as an orphan.

### Also

- `ownerOfCapture` reads the actor id up to the timestamp rather than to the
  first hyphen. Foundry's own ids never contain one, but an id that came from
  somewhere else might, and reading half of it would name the wrong student.
- Two captures taken in the same millisecond share a timestamp, so the darkroom
  carries its own sequence rather than leaving the order to the sort's mercy.
- New on the macro API: `partyNotebook`, `sweepCaptures`, `orphanCaptures`.

### Tests

371 checks, up from 324. The journal stub grew ownership and `_stats`, and the
file picker is now stubbed with a folder listing the test controls — which is
what makes the sweep, its encoding fix and both of its refusal paths testable
without a disk.

## 1.9.0 — Notes, a camera, and images that move between students

Four new things, and one of them is not stored by this module at all.

### Notes

A notebook on the scroll, which is a **Foundry journal** wearing the scroll's
clothes. Each student has one `JournalEntry`; each note is a page in it.

That choice is the feature. The pop-out is Foundry's own journal window, because
a journal already has one. The GM can read and annotate any student's notes from
the sidebar, because a journal is already in the sidebar. Two clients stay in
step without a line of sync code, because Foundry syncs documents. And it
survives the Danger Zone wipe, because it was never scroll data.

- **Who makes what.** A player cannot reliably create a `JournalEntry` — that is
  a world permission and it is off by default — but a player who *owns* an entry
  can create, update and delete pages inside it. So the GM's client issues the
  notebooks on ready, and players own everything from then on. A player who has
  never had a GM connect sees an empty state saying so rather than a broken app.
- **Found by flag, not by name**, so renaming it in the sidebar doesn't orphan
  it. Assigning a player to a different character moves the ownership across on
  the GM's next load, or the moment the assignment changes if a GM is connected.
- **Plain text in the scroll, anything at all in the journal.** The scroll's
  editor is a textarea, so it will only offer to edit pages that are plain to
  begin with. A page carrying a table, a link or an embedded image is shown as
  text, marked, and pointed at the pop-out — because a plain-text save over it
  would flatten the formatting rather than fail, and silently losing the GM's
  handout is much worse than declining to edit it.
- The Command Center's **Info** tab now links straight to the student's
  notebook, which otherwise means finding one entry among however many the world
  has by knowing what it is called.

### Camera

A camera app that photographs the canvas as that player sees it, and files the
result in their gallery.

- **Their vision, not yours.** Each client renders the scene through its own
  eyes, so a player's capture already carries their fog and nothing they can't
  see. There was no filtering to write.
- **The screen is not in the shot.** The capture is a render of `canvas.stage`,
  so chat, the sidebar and the scroll itself are all absent — which is the
  photograph you wanted. Rendering the stage into a texture rather than reading
  the screen buffer also sidesteps whether the drawing buffer was preserved
  after the last frame, which is the usual reason canvas screenshots come back
  blank.
- **Capture, then keep or retake.** The capture is free; the file it turns into
  is not.
- **How it gets stored.** A viewport JPEG is a few hundred kilobytes — far too
  much for an actor flag, which is synced to every connected client every time
  it changes — so it becomes a file under `<gallery folder>/captures/`. Most
  players do not have Foundry's upload permission, and for them the capture is
  relayed to the GM's client and written there, the same shape as the message
  relay. If a player *does* have the permission, they write it themselves and
  the GM is never involved.

### Images that move between students

- **Attach an image to a message.** A paperclip on the composer picks from your
  own gallery. The message shape has carried an `image` field since v1.6 and the
  relay has always passed it through — this is the UI that was missing.
- **Share straight into someone's gallery.** From the lightbox: pick any number
  of students, send. It lands in their gallery tagged with your name, they get
  an alert saying you shared it, and a toast if they're at the table. Sharing
  goes through the GM relay, because a player cannot write another player's
  flags.
- **Save an image someone sent you** into your own gallery, from the lightbox on
  the message.
- **Download anything** to your own machine, also from the lightbox. Fetched
  into a blob first so the file gets the caption for a name rather than whatever
  the path ends in; a remote image that refuses the fetch falls back to a plain
  download of the path.
- **Remove images from your own gallery.** This takes out the entry, not the
  file — the same photo may be in three other galleries, and a student tidying
  their own has no business reaching into anyone else's.
- **The GM can send one image to every student at once**, from the Command
  Center's Gallery tab or `zs.addGalleryImageAll(...)`. Everyone gets an alert
  as well, because an image appearing in your gallery with no explanation is a
  bug rather than a gift.
- **Paths are checked before they become an `src`.** Anything arriving over the
  socket goes through `safeImageSrc` at the relay *and* again at the point of
  render: `javascript:` is refused for the obvious reason, and `data:` is
  refused because it would be a megabyte of base64 written into someone else's
  actor flags.
- Gallery entries gained `id`, `ts` and `from`. Pre-v1.9 rows of bare
  `{src, caption}` keep working and pick up the new fields as they are touched;
  the gallery is sorted newest first, and a shared image says who sent it.

### Also

- The Command Center's gallery rows have a **browse button** now, rather than a
  path you had to type from memory.
- New on the macro API: `addGalleryImageAll`, `gallery`, `notebook`,
  `issueNotebooks`.

### Tests

323 checks, up from 251. The fake DOM grew a journal layer — entries, pages,
ownership and all — which is what makes the notes path testable at all. Worth
recording why `pages` in that stub is deliberately not a `Map`: Foundry's
`EmbeddedCollection` spreads to documents and `[...aMap]` spreads to
`[key, value]` pairs, so a `Map` would have made `[...book.pages]` quietly wrong
in exactly the way the real code depends on.

The camera's own render path still needs a GPU, so what is covered here is
everything around it: the paths, the filenames, the permission fork and both
refusal branches at the relay.

## 1.8.2 — Views that piled up, and a way back to the bracelet

### Screens on top of each other

Three separate faults, all of which showed as one thing: two screens' worth of
the device drawn over each other.

- **Navigating twice inside a transition left an orphan on the stage.**
  `_paint()` animates the outgoing view out and removes it on `animationend`,
  with a 400ms timer as the backstop — so for a quarter of a second there are
  legitimately two views on the stage. It found the outgoing one with
  `firstElementChild`.

  New views are *appended*, so the first child is only the outgoing view while
  nothing has interrupted the transition. Tap through the dock at any speed —
  Messages, Contacts, Notices — and the second tap re-animated the view that was
  already leaving and handed the view in between neither an out class nor a
  removal. It stayed on the stage at full opacity, under the live view, for the
  rest of the session; the third tap left another. It reads as ghost text
  bleeding through every screen after it.

  The outgoing view is `children.pop()` now, and anything still on the stage
  behind it is a leftover from an interrupted transition and is removed outright.

- **Switching "Reduce motion" on mid-slide froze a view at full opacity.**
  `.zs-calm` sets `animation: none`, which cancels the outgoing view's
  `zsvOut*` — so it never reached `to { opacity: 0 }` and never fired the
  `animationend` that was supposed to remove it. Reaching for the toggle to calm
  the interface down was the one gesture guaranteed to make it overlap, for as
  long as the 400ms backstop took.

  The toggle now goes through `ScrollUI.setCalm()`, which settles the stage by
  hand: leftovers dropped, transition classes stripped from whatever is left
  standing. The `.zs-calm` block covers `.zsu-view` too, so the rule is honest
  about what it cancels.

- **Reopening the device while it was closing stacked two backdrops.**
  `close()` fades `#zs-ui` and removes it after 320ms. Opening again inside that
  window built a second full-screen overlay on top of the first: the canvas
  dimmed twice, and the dying one — still a live click target — swallowed the
  clicks meant for the new projection. `close()` now keeps hold of the fading
  element and `render()` retires it, sweeping up any other stray `#zs-ui` on the
  way. A projection on its way out is also `pointer-events: none` now, as is a
  toast on its way out.

Two smaller ones found alongside:

- `animationend` **bubbles**, so a child element finishing an animation of its
  own could pull the whole outgoing view out early. The handler checks the
  target.
- **Two messages arriving together gave you one truncated bracelet flash.**
  `pulse()` added a class that was already there, which does not replay an
  animation, and the second timer then stripped it part-way through the first
  one's. It restarts the animation properly and keeps a single timer.

### Getting the bracelet back

The bracelet is draggable and remembers where you left it, which means it can be
left somewhere you can't reach — behind a docked sidebar, or off the edge of a
monitor that isn't plugged in any more.

- **"Recentre the Scroll"** in the module settings sheet. It is a button rather
  than a value, and `restricted: false`: the position is a per-user flag, so
  every player needs their own, not just the GM.
- **Shift+G** does the same thing. Registered through `game.keybindings` rather
  than a raw listener, so it shows up in *Configure Controls*, can be rebound,
  and stays quiet while you are typing in a text field.
- **`zs.recentreScroll()`** for a macro.
- **It is clamped back into the viewport** on load and on every window resize,
  so a position saved on a wide monitor can't strand it on a narrow one. The
  clamp writes only when the bracelet is genuinely outside, so dragging a window
  wider doesn't spam the user flag, and it stands down entirely while a drag is
  in progress.

### Tests

26 new checks, and the fake DOM grew `lastElementChild`, `classList.toggle`,
`document.querySelectorAll` and window listeners to support them — the shell
needed all four and none were stubbed, which is why none of this was catchable
before. The `init` hook is now actually fired in the suite rather than only
collected, which is what lets the settings menu and the keybinding be tested at
all.

## 1.8.1 — Foundry was sizing the buttons

Every button in the module was being laid out by Foundry, not by this
stylesheet, and had been all along. The v1.8 preview could not see it because
the preview was not running Foundry.

### The bug you reported

- **Buttons no longer collapse onto their neighbours.** Foundry's
  `foundry2.css` styles the bare `button` element for the whole document, with
  no scoping that keeps it out of a module's own DOM:

  ```css
  a.button, button {
    height:      var(--button-size);   /* 2em */
    min-height:  var(--button-size);
    line-height: normal;
    font-size:   var(--font-size-14);
    ...
  }
  ```

  This stylesheet never declared `height`, `min-height`, `line-height` or
  `font-size` on a button — it had no reason to, since a button sizes to its
  content — so all four fell through to Foundry unopposed and **every button in
  the device was clamped to a flat 2em box regardless of what was inside it.**
  `.zsl-open` needs 34px for its glow and its caption and was given 27, which is
  why TOUCH THE STONE sat outside its own rectangle. The home grid's `.zsn-app`
  needs 38 and was given 28, which is why the tiles crowded the row beneath
  them. Notices was the one screen that looked right because it is the one
  screen built entirely from divs.

  Section 23 of the stylesheet takes those properties back. It is written with
  zero-specificity `:where()` selectors, which is the point: Foundry puts its
  rules in a cascade layer, an unlayered rule beats a layered one whatever the
  specificity on either side, and a *zero*-specificity unlayered rule therefore
  wins against Foundry while still losing to every ordinary rule in this file.
  It restores the defaults the device was designed against and gets out of the
  way. A plain `#zs-ui button { … }` would have won against Foundry too — and
  also against `.zsl-open` and `.zsn-app`.

  The same containment covers `input`, `select` and `textarea` (Foundry pins
  those to a fixed `--input-height` with a matching `line-height`, and gives
  every textarea a 60px floor in a monospace face), `h1`–`h6` (`margin: 2rem 0
  1rem`), and lists. It is removal of styling that should never have arrived,
  and nothing else.

- **The measurements no longer drift with the host.** Size and leading are now
  anchored on the device roots. The scroll is appended to Foundry's `body`, so
  anything it did not declare came from Foundry — 15px/1.25 in v14 — which meant
  every rule here that omitted a font size was being set by the host, and the
  design's own 13px base step only applied where a rule happened to name it.
  `--zt-lh: 1.5` is now the body leading, so anything that can wrap (message
  bubbles, notice bodies, event descriptions) has room between its lines.

### Three boxes that were genuinely too small

Found by measuring, once the preview was honest enough to measure against:

- **The lock screen clock** set `--zt-display` solid (`/1`), reserving 68px for
  81px of ink, so the date and the rule beneath it sat 13px closer than the
  design said. Now `/1.2`.
- **The home-screen badge** was a 20px box with 2px borders — 16px of content —
  carrying a 20px line-height. Now centred with flexbox instead of counted in
  pixels.
- **The bank balance** set 22px type in a 1.1 box, 24px for 26px of ink. Now
  1.25.

### The preview was the real bug

`render-preview.mjs` rendered the module against its own stylesheet and nothing
else, so it was a *kinder* environment than the one the module ships into and it
lied in the module's favour. Three changes:

- **`tests/foundry-baseline.css`** — a transcription of the rules in
  `foundry2.css` (v14.367) whose selectors are bare element names, so they reach
  inside `#zs-ui` and `#zs-gm`. Loaded before the module stylesheet, layers and
  all. Refresh it on a Foundry major bump.
- **The GM Command Center is in the preview**, all ten tabs. It is the other
  half of the module's surface area, it is a form stack, and it suffers the
  host's `input`/`button` rules harder than the device does — and it was not
  being looked at.
- **`selected` and `checked` are serialised.** They are properties, not
  attributes, so every `<select>` in the preview used to show its first option:
  the relationship ranks all read "-5 Nemesis" whatever the fixture said.

Swept afterwards for boxes whose content does not fit and for siblings that
overlap: 42 device panels across three panel heights, plus ten command-centre
tabs, all clean.

## 1.8.0 — Room to breathe

Everything got bigger, the status bar went away, and the lock screen stopped
cutting its own unlock button in half.

### The bug you reported

- **The lock screen no longer clips.** `.zsl-wrap` had no overflow rule at all,
  so when the content was taller than the space available the `margin-top: auto`
  pushing the unlock button to the bottom collapsed to zero and the button
  overflowed past the panel edge — where the screen's `overflow: hidden` sliced
  through it. At a panel height of 520px the words "TOUCH THE STONE" were cut in
  half. Fixed three ways at once, because one of them should never have to be
  enough:
  - `.zsl-wrap` scrolls rather than clipping, as a floor under everything else.
  - The dock **collapses** on the lock screen instead of merely being invisible,
    recovering the ~56px of height it was holding while showing nothing.
  - The lock screen's spacing now responds to the **panel** rather than the
    window, via container queries. The old `@media (max-height: …)` blocks were
    keyed to the viewport, so they missed exactly the case that broke: a tall
    window holding a panel clamped against its own `vh` cap.

  Swept from 880px down to 280px: the unlock affordance is reachable at every
  height, and needs scrolling only below 340px.

### Bigger

- **The projection is 480×880**, up from 430×780, and clamps at 92vh rather
  than 88vh.
- **A type scale.** The stylesheet carried 121 font declarations across about
  twenty distinct pixel values, which made "make the text bigger" twenty
  separate decisions. Every text size now names a step (`--zt-2xs` … `--zt-2xl`,
  plus `--zt-display`), and the scale was raised once: roughly +1px at the small
  end and more at the top. Nothing sits below 10px any more — the 8–8.5px
  micro-labels were the main reason the device read as cramped.
- **App tiles are 62px**, up from 52px, with room in the grid for their badges.
- Contact circles, dock buttons, app-bar controls and icon glyphs all grew to
  match.

### The status bar is gone

It carried four things and two of them were duplicates or decoration.

- **The clock** was a smaller copy of the lock screen's. Dropped.
- **The charge meter** was pure flavour. Dropped — that is the point of
  removing the bar.
- **The bell became Alerts**, a real app in the grid with a badge of its own,
  plus a bell in the home header so the badge is visible the moment you unlock.
- **The aether meter became a strip in Messages**, shown only when no GM is
  connected — which is the one state it ever actually reported, on the one
  screen where it changes what you can do.

### Overlaps and alignment

- **Contact tooltips are no longer clipped.** They sat at `bottom: calc(100% +
  8px)` inside `.zsu-scroller`, which clips on both axes, so the top row of
  every category lost its tooltip upward and the outer columns lost theirs
  sideways. They now render into `<body>` at `position: fixed`, placed from the
  circle's own rect, and flip below the anchor when there is no room above.
- **The close button moved inside the panel.** At `top: -14px; right: -14px` it
  floated outside the frame on the outer bloom, and on a short viewport it could
  end up under the browser chrome with nothing left to click. It now sits at the
  app bar's right end, which the bar reserves room for.
- **The app bar centres its title with a real grid.** The old flex version
  balanced a 30px back button against a 30px spacer, so the title was centred
  only while the trailing control happened to be exactly 30px wide — the
  Messages thread header, which swaps the title for an avatar block and adds a
  mute button, was visibly off. All 36 app bars now measure dead centre.
- **The dock distributes evenly.** `space-around` with `flex: 1` children that
  also carried a `max-width` does not: the children grew to their cap and the
  leftover space was split unequally around them.
- **App tile badges** are inset and the grid gap widened, so a badge no longer
  lands a pixel from the neighbouring tile.
- **Centred letter-spaced labels sit on centre.** CSS adds the letter-space
  after the final character too, so a centred line with `letter-spacing: 3px`
  rendered its glyphs 1.5px left of true centre. Cancelled on the nine centred
  labels where the tracking was wide enough to see.
- **The emitter haze is capped** and skipped entirely when the bracelet has been
  dragged inside the frame's own rect, where its glow used to wash over the
  panel it was opening.
- **Form controls size to their border box.** Every full-width field was
  `width: 100%` with its own padding and border under the default `content-box`,
  making it 27px wider than its container — so the right border of the device
  name field, the reply composer and the contact notes textarea were all sliced
  off. Found by measuring the rendered page, not by the test suite.

### Bank

- **A Bank app.** A balance card per currency, tinted and iconed from the
  currency's own configuration, over a **ledger** of what moved and why.
- **Currencies are a list, not a single item name.** `currencies` is a world
  setting of `{ key, itemName, label, icon, tint, primary }`, defaulting to
  Marks and Astras. Both store their amount in `system.quantity` on an inventory
  item, which is why one shape covers both. A missing or renamed item reads 0
  rather than throwing.
- **`zs.grant(actor, key, amount, reason)`** moves a balance, appends a dated
  ledger line and raises an alert. A negative amount is a charge; a balance
  never goes below zero; a student with no currency item yet gets one created
  rather than having the grant dropped on the floor.
- The **Student ID card's currency stat** follows whichever currency is marked
  primary.
- A **Bank tab in the Command Center** edits the currency list and grants
  directly.
- `getMarks()` is kept as a thin alias, and a world that renamed its Marks item
  before v1.8 still reads the old setting.

### Token images

- **The small circular avatars draw from token art** — home header, message
  avatars, contact grid, Student ID — via `portraitOf()`, which prefers
  `prototypeToken.texture.src` and falls back to `actor.img`.
- **The 96×118 contact detail portrait deliberately keeps `actor.img`.** It is a
  tall rectangle through `object-fit: cover`, so a square token loses its sides
  and any ring baked into the token art gets cut through. That panel is the one
  screen where large character art earns its space.
- `useTokenImages` (default on) turns the whole behaviour off without a code
  change.
- Contacts *store* their portrait when added, so **Refresh Portraits** in the
  Command Center's Rels tab (and `zs.refreshPortraits()`) brings existing
  entries up to date. Hand-typed portraits with no actor behind them are left
  alone.

### Alerts

- **Per-notification dismiss.** Each row carries its own `×`; the bulk "Clear
  log" is still there. The row became a wrapper rather than being a single
  `<button>`, because a button inside a button is invalid markup that browsers
  resolve by silently dropping one of them.
- Unread alerts carry an accent edge.

### Danger Zone

GM-only, in the Command Center, and in three deliberate steps.

- **Export all scroll data to JSON first**, and the panel says in as many words
  that it is the only undo a clear has.
- **A passphrase**, stored as a salted hash and never in plain text — world
  settings sync to every connected client. `crypto.subtle` is only exposed in a
  secure context, so a table running over plain HTTP on a LAN address falls back
  to a pure-JS hash. A record written under either algorithm still verifies
  under the other.
- **Clear All Scroll Data** requires the passphrase *and* typing `DELETE`, and
  lists exactly what will be removed and from how many actors first. Flags are
  **unset** rather than overwritten with empty objects, so the actors come back
  genuinely clean. World notices and the calendar are a separate checkbox,
  **off by default** — they are the school's content rather than anything a
  scroll holds.

  Be clear about what the passphrase is: a misclick guard, not security. Anyone
  with GM rights and a browser console can bypass the dialog. What actually
  stops a player wiping the campaign is Foundry's permission model — a player
  cannot write another actor's flags at all.

### Smaller

- **The SCROLL label is legible on any map.** It was dim gold at .75 opacity and
  7px, which on a bright scene was close to invisible; it is now near-white at
  full opacity with a hard shadow.

### Testing

- The smoke suite is at **225 checks**, up from 134.
- **`node tests/render-preview.mjs`** is new: it renders every view through the
  real `ScrollUI` and writes one page holding all of them at three panel
  heights, styled by the real stylesheet. Open it and look. None of the layout
  bugs above are catchable by the smoke suite — it renders views and asserts
  structure, not geometry — and the form-control clipping was found only by
  measuring the rendered page.

### Not in this release

- **C2 (UUID keying)** is still unstarted. Conversations, portraits and
  relationship entries all key off actor *name*, so renaming an actor detaches
  all three at once. It needs a schema migration and a design of its own rather
  than a footnote to a layout release.
- **Sound** is still an open decision: WebAudio-synthesised tones (keeps the
  no-binary-assets rule, thinner palette) or four small files (breaks the rule,
  sounds better).

## 1.7.0 — The bracelet

The device stopped being a slab you tap and became a bracelet you wear. The
screen it opens is now a portrait projection made of light rather than a
near-square panel in a metal frame, and there is a shell around the apps
instead of six hardcoded tabs.

### The object

- **The icon is a bracelet**, drawn as inline SVG (still no image assets): a
  metal cuff seen at an angle with a gold-set cabochon on the front. The old
  52×110 clip-path slab is gone, and with it the mismatch between a tall
  handheld icon and a wide landscape screen — the bracelet is the object, the
  screen is a projection, so they no longer have to be the same shape.
- **The projection is portrait, 430×780**, and made of light: no bezel, no
  gems, no metal. An outer bloom, a hairline accent edge, gold corner ticks and
  a scanline texture.
- **It unfurls from the stone.** The panel animates out of the bracelet's actual
  on-screen position — a sliver, then a column, then the panel — with a haze at
  the emitter. Drag the bracelet somewhere else and the projection opens from
  there instead.

### The shell

- **Lock screen** — clock, in-world date, device name, next event, and what
  you've missed. Skippable in Settings.
- **Home screen with an app grid**, replacing the fixed six-tab bar. Adding an
  entry to `APPS` in `core.mjs` is all it takes to add an app.
- **Status bar** — clock, aether signal, charge meter, notification bell. The
  signal reads full when a GM is connected and drops to one amber bar when none
  is, which is the same condition that stops messages being deliverable.
- **Notification centre** — toasts used to vanish with no record. Every toast is
  now also logged (capped at 40), openable from the bell, and tapping an entry
  jumps to the app it came from.
- **Dock** pinning Home, Messages, Contacts and Notices, with badges.
- **Two new apps: Notices** (the school board) and **Settings**.

### Personalisation

- **Accent colour per student** — Aether, Verdant, Ember, Amethyst, Rose, Gold.
  Tints the bracelet's stone and the entire projection.
- **Custom device name**, shown on the lock screen.
- **Per-student toggles** for skipping the lock screen and reducing motion.

### C1 — world content split out of actor flags

Announcements and events were copied into every student and pushed out with
"copy to all" buttons, so editing one left every player holding a stale copy.

- **Notices and the calendar are world settings now.** One list, edited once, in
  the Command Center's Notices and Calendar sections. The "copy to all" buttons
  for them are gone because there is nothing left to copy.
- **Dismissals stay per-actor**, which is the part that was genuinely personal.
- **A one-time migration** lifts existing content into world scope the first
  time a GM loads the world. It harvests the *richest* student's list rather
  than the first, because a student added after the last push holds an empty one.
  The old actor data is left in place rather than deleted.
- **Until that migration runs, per-actor notices still display**, so a world
  whose GM hasn't logged in yet doesn't show players an empty board.
- The calendar holds many events and counts down to the soonest one that hasn't
  passed, instead of holding exactly one.

### Render architecture

- **The frame is built once; only the stage repaints.** `render()` draws the
  projection, `_paint()` swaps the view inside it. The status bar, dock and
  entry animation survive a refresh.
- **View transitions** — push/pop slides between views, cross-fade for a data
  refresh.
- **In-flight input survives a repaint.** A field tagged `data-zs-field` keeps
  its value, cursor and selection, and `data-zs-scroll` regions keep their
  offset, so a GM save no longer costs a player the sentence they were typing.

### Behaviour

- **`muted` is wired up.** It was stored and never read. A muted thread now
  delivers silently — no pulse, no toast — while still writing the message and
  the notification-centre entry.
- **Day separators and grouped senders** in threads, instead of a timestamp on
  every bubble and a name on every line of a run.
- **C4: pre-v1.6 messages get inferred sort timestamps**, so old threads order
  correctly instead of falling back to reverse creation order.
- **C5: the Marks item name is a setting** rather than the hardcoded string
  `"marks"`.
- **C6: a schema version is recorded**, so future migrations can be targeted.
- The macro API gained `postNotice`, `setSchoolEvent`, `clearSchoolEvent` and
  `advanceDay`. `setEvent`/`setEventAll` still work and forward to
  `setSchoolEvent`.
- NPC messages, gallery additions and rank changes raise notifications.

### Accessibility

- **Everything clickable is a real `<button>`** with an accessible name. The
  interface was previously a wall of `<div>`s with click handlers, unreachable
  by keyboard and opaque to a screen reader.
- **Focus rings restored.** v1.6 had `outline: none` in five places with nothing
  put back; rings are now scoped to `:focus-visible`.
- **`prefers-reduced-motion` honoured**, plus a per-student toggle. The infinite
  stone glow, the unfurl, the boot sweep and every transition stop.
- **Escape steps back** through the view stack, and closes the lightbox first.
- The lightbox has a real close button and focuses it on open.

### Housekeeping

- **`fa-grid-2` replaced** — it is Font Awesome *Pro*, and Foundry ships Free,
  so the home dock icon was rendering as an empty box.
- The z-index ladder is a documented set of tokens. The bracelet sits clear of
  Foundry's window range instead of below it at 90, where open sheets covered it.
- Accent colours are tokenised throughout; no rule hardcodes the old cyan, so a
  non-default accent no longer produces two-tone message bubbles.
- Responsive: the panel clamps on short and narrow viewports, and the app,
  contact, gallery and swatch grids drop a column rather than cramping.
- Repo: `README.md`, `CHANGELOG.md`, `LICENSE`, `.gitignore`, and `module.json`
  metadata (`url`, `manifest`, `download`, `readme`, `changelog`, `bugs`) so the
  module can be installed and updated by manifest URL.
- Tests: 64 → 134 checks, now covering world content, the C1 migration, the
  notification log, timestamp backfill, mute, day separators, and every view and
  app rendering.

---

## 1.6.0

### Track A — V14 compatibility and correctness

- **Context menu hook renamed.** `getActorDirectoryEntryContext` stopped firing
  in V13; it is now `getActorContextOptions` with signature
  `(application, menuItems)`, and entry callbacks receive a plain `HTMLElement`.
  Both GM directory entries were silently dead before this.
- Native `confirm()` replaced with `confirmDialog()`, preferring
  `foundry.applications.api.DialogV2.confirm`.
- **`saveSection(actor, section, data, {silent})`.** `silent: true` tags the
  update so the `updateActor` hook skips the re-render — needed by anything that
  autosaves while the user is typing.
- **`this.relContact` on ScrollUI**, so the contact detail panel survives a
  re-render instead of bouncing back to the grid mid-sentence.
- **Messages carry `ts`** as well as the display-string `time`, so the thread
  list sorts on real time while the GM can still backdate narrative messages.
- **Announcements have stable `id`s**; dismissals key off them rather than array
  position, which used to shift everyone's dismissals onto the wrong rows.
- `esc()` applied to everything user- or NPC-authored going into `innerHTML`.
- Conversation list sorts by actual last-message time. Empty conversations are
  listed instead of vanishing. `enablePlayerMessaging` is actually read.
  Sending to a player checks a GM is connected. The relay verifies the sender
  owns the actor they claim and copies only known fields off the wire. Group
  creation puts every member on one `convId`. Toasts stack up to 3.

### Track B — restructure

- One 2000-line `.mjs` split into `core`, `data`, `socket`, `ui-scroll`,
  `ui-gm` and `api`, with imports running one direction only.
- Module-level `let` singletons replaced by the `app` registry in `core.mjs`.
- Stylesheet expanded from 102 minified lines to 2152 readable ones, rule order
  and every declaration reproduced verbatim.
- `tests/smoke.mjs` — 64 checks.

---

## 1.5.0

Last version built in Claude.ai chats. Draggable slab icon with a scanline boot
sequence, six tabs (Home, Schedule, Gift, Messages, Relationships, Gallery),
conversation-object messaging with a GM socket relay, visual-novel relationship
panel with autosaved private notes, gallery lightbox, and the GM Command Center.
