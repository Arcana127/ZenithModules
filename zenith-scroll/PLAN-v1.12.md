# v1.12 — the Gift tree, planned

> **STATUS: BUILT.** Shipped as v1.12.0. Every section is done; 513 checks pass,
> up from 434.
>
> **One thing is deliberately outstanding: the PF2e verification in section 6.**
> It needs a running world rather than a test stub, and it is listed at the end
> of the v1.12 CHANGELOG entry so it is not lost.
>
> Four things the build changed from the plan below:
>
> - `x`/`y` clamping and node cleaning live in `world.mjs` beside the storage
>   rather than in the editor, so a tree written by a macro is defended the same
>   way one dragged in the editor is.
> - The board's coordinate space is **inset by half a node** (`.zgt-stage`).
>   Section 3 did not anticipate that a node centred on its own percentage, with
>   a link handle hanging below it, is clipped at 0% and 100% by the board's own
>   `overflow: hidden`. Found by measuring the rendered preview, not by reading
>   the CSS.
> - The editor has no save button. Every edit writes straight to the library,
>   because a board with unsaved state loses work each time the tab is switched.
> - **Pinch zoom was not built.** Section 4 asked for wheel *and* pinch; the
>   viewer has drag-to-pan, wheel zoom and two explicit zoom buttons. Pinch needs
>   two-pointer tracking that would have to co-operate with the pan handler, and
>   the device is overwhelmingly used on a desktop Foundry client. A half-built
>   pinch that fights the drag would be worse than none.
>
> Kept as written below, as the record of what was decided and why.

Requested: a skill tree that works like a video game's. Multiple paths, points
you spend, nodes you drag into place yourself, prerequisites you declare, and
nodes that hand over abilities or items automatically when they are taken.

---

## 0. Decisions — answered, no longer open

| # | Question | Decision |
|---|---|---|
| 1 | Where does a tree live? | **World library, plus composition.** A shared trunk everyone has, plus a branch assigned per student. Section 1. |
| 2 | Who spends points? | **The student, self-serve.** The GM is notified, not asked. Section 5. |
| 3 | Layout | **Free drag on a board.** Position stored as a percentage. Section 3. |
| 4 | Game system | **Pathfinder 2e.** Matters only for grants — section 6. |
| 5 | Point pool | **One shared pool** across every tree a student is on. Section 7. |
| 6 | Undoing a node | **GM-only**, and it takes back exactly the items the unlock created. Section 8. |

---

## 1. Where a tree lives

### The problem with v1.11

A student's whole tree — every node, name, description, cost and edge — is a
blob on their own `academic.giftTree` flag. One shared tree therefore exists as
six independent copies. Fixing a typo is six writes; rebalancing a cost is six
writes, each of which has to carefully preserve what that student already spent.

### The library

Tree *bodies* become world content, in the same place notices, the calendar,
maps and the queue already live:

```js
WS.giftTrees = "worldGiftTrees"   // v1.12
```

```js
{
  id:    "core",             // referenced by assignment and by namespaced node ids
  name:  "Awakening",
  nodes: [ ... ],            // section 2
}
```

The actor keeps only what is genuinely personal:

```js
academic.giftTree = {
  trees:    ["core", "emberpath"],   // which trees this student is on, in order
  unlocked: ["core:n4", "emberpath:n1"],
  points:   3,
  granted:  { "emberpath:n1": ["AbCd1234EfGh5678"] },   // section 6
}
```

A library is a filing cabinet, not a uniform. Six students can be on six
unrelated trees; what the library buys is one place to edit them, reuse across
students, and edits that never disturb anyone's progress.

### Composition — the trunk and the branch

A student is assigned a **list** of trees, not one. Usually two: the common
Awakening trunk, plus the personal Gift branch.

Node ids are namespaced by their tree — `core:n4`, `emberpath:n1` — which is
what makes the interesting part possible: **a branch's root can require a trunk
node.** `requires: ["core:n4"]` on `emberpath:n1` means the branch grows out of
that specific point on the trunk, and the viewer draws the whole thing as one
continuous board. The student does not experience two trees; they experience one
tree that goes personal partway up.

Nothing limits it to two. A third tree assigned mid-campaign, hanging off a
milestone, needs no new mechanism.

### Backwards compatibility

`getGiftTree` keeps working on a v1.11 actor-local tree: an actor whose flag
still carries `nodes[]` is treated as being on one implicit anonymous tree, so
anything already written against the v1.11 shape renders unchanged. The
migration lifts such a tree into the library under a generated id, in the same
GM-only, run-once style as the C1 notices migration. `SCHEMA_VERSION` → 3.

---

## 2. The node shape

Additive only. Every v1.11 field keeps its meaning; `getGiftTree` already passes
`nodes` through whole, so nothing written against the README's shape breaks.

```js
{
  id:          "n1",
  name:        "Ember Fist",
  kind:        "buff",        // buff | freeform | milestone | capstone
  cost:        2,             // points; 0 for something given
  requires:    ["n0"],        // ALL of these must be taken first
  description: "",            // flavour
  effect:      "",            // mechanics

  // --- new in v1.12 ---
  x:           42.5,          // percent of board width   \ free drag,
  y:           18.0,          // percent of board height  / section 3
  grants:      [],            // section 6
  tier:        "t1",          // now a LABEL only, see below
  requiresAny: false,         // reserved; see section 9
}
```

**`tier` stops driving layout.** With free drag, `x`/`y` place a node and `tier`
survives only as a grouping label — useful for filtering and for drawing tier
bands behind the board, never for position. The field stays because the README
published it; the renderer stops reading it for geometry.

Position is a percentage of the board, not a pixel — the same decision map pins
made in v1.11, and for the same reason: the board is 480px wide on the device
and much wider in the editor, and a percentage lands correctly in both with
nothing to recompute when anything resizes.

---

## 3. The editor — Command Center → Gift

The Maps tab set the precedent in v1.11: you place pins by clicking the actual
preview, because typing two percentages and reloading is not a workflow. Same
principle, more of it.

**Tree list.** Create, rename, duplicate, delete. Duplicate is the honest way to
start a student's branch from another student's.

**The board.** The tree drawn at editor size.

- Drag a node to move it. A snap-to-grid toggle, on by default, because a tree
  that is 3px out of line looks broken and nobody wants to nudge pixels.
- Drag from a node's edge handle onto another node to create a `requires` edge.
  Click an edge to delete it. The direction is prerequisite → dependent, drawn
  with an arrowhead, because a tree with ambiguous edges is unreadable.
- Add, duplicate and delete nodes from a toolbar.

**The inspector**, beside the board, for the selected node: name, kind, cost,
description, effect, and the grants drop target (section 6).

**The validation strip**, always visible, catching what makes a tree
unplayable rather than merely ugly:

- a cycle in `requires` — A needs B needs A, and neither can ever be taken;
- a node no path reaches from any zero-cost root;
- an edge pointing at a node id that no longer exists, in this tree or a
  referenced one;
- a grant whose UUID no longer resolves;
- total cost of the tree against the points actually issued, as a sanity line
  rather than an error.

**Preview as student**, with a points figure you type, showing exactly what a
student with that many points would see and could afford.

**Assignment.** Per student, the ordered list of trees they are on, plus their
point balance and a grant control.

---

## 4. The viewer — the Gift app

The panel is 480×880. A real tree does not fit in it statically, so:

- **drag to pan, wheel/pinch to zoom**, with a recentre control, and an initial
  view framed on the frontier — the nodes they can afford right now — rather
  than on the root they took six sessions ago;
- **four node states, drawn differently**: taken, affordable now, locked by
  requirements, locked by cost. The distinction between the last two is the
  whole point — "you cannot afford this yet" and "you have not earned the right
  to this" are different messages and a tree that conflates them is frustrating;
- **edges lit when both ends are taken**, dim otherwise, so a completed path
  reads as a path;
- **tap a node** for a detail sheet: name, kind, cost, description, effect, and
  what it grants;
- **spend behind a confirm.** Self-serve, but never a mis-tap.

The four `kind`s already exist so the renderer can draw them differently — buff
sharpens, freeform widens, milestone is a story beat rather than a purchase,
capstone ends a branch — and this is where that finally pays off.

The v1.8 milestone track stays as a fallback for a student on no tree at all.

---

## 5. Spending

`unlockGiftNode` already does the work and is already owner-only, so the student
spends their own points with no relay: they own their actor, and the write is to
their own flags. It raises an alert on unlock, which is the GM notification.

The GM keeps `zs.unlockGift(name, id, {force: true})` for granting something
outside the rules, which happens more often than a tree admits.

---

## 6. Grants — PF2e

A node carries what it hands over:

```js
grants: [
  { uuid: "Compendium.pf2e.feats-srd.Item.XXXXXXXX", name: "Ember Fist", img: "..." },
]
```

In the editor you **drag an item from a compendium or the sidebar onto the
node**, and the drop stores its UUID. `name` and `img` are cached alongside so
the inspector and the student's detail sheet can render the grant without the
pack being open, and so a dead UUID still shows *what* has gone missing.

On unlock: `fromUuid` → `toObject()` → `actor.createEmbeddedDocuments("Item", …)`.
The player owns their own actor, so this needs no GM relay — the same path
`grantCurrency` already takes. The ids of what was created go into
`granted[nodeId]`, so section 8 can take back exactly what this unlock added
rather than guessing by name.

**A dead UUID must not block the unlock.** The node is taken, the points are
spent, and the failure is recorded and alerted to the GM — the same reasoning as
`grantCurrency`'s missing-item branch: "she has never been paid" and "she cannot
be paid" are different problems and the second one is the GM's to fix.

**To verify against the installed PF2e build before this is called done** — these
are not safe to assume and should be checked in the world:

- a feat created with no `system.location` lands in the Feats tab unassigned.
  Acceptable if so; if PF2e rejects or mis-files it, the node needs a
  location/category field.
- a granted item's **rule elements run as normal**, which is the desired
  behaviour — the grant should be indistinguishable from dragging the feat on by
  hand.
- an item carrying a **ChoiceSet** prompts on creation. If it does, a student
  taking such a node gets a PF2e dialog mid-unlock. That is probably fine and
  possibly desirable, but it must not be a surprise, and it interacts badly with
  the confirm step if the dialog can be cancelled after the points are spent —
  spend *after* the create resolves, not before.

---

## 7. Points

One pool. A student spends it anywhere they have unlocked access to, trunk or
branch, and choosing to go deep on the trunk instead of racing into the branch
is a real decision rather than an accounting error.

- granted from **Command Center → Gift**, and `zs.grantGiftPoints(name, n)`;
- `points` is what is **left**, as today; spent is derivable from `unlocked`.

---

## 8. Undo — GM only

No player-facing respec: a tree whose choices are free stops being a set of
choices.

- **Refund one node** — returns its cost and deletes exactly the item ids in
  `granted[nodeId]`.
- **Reset the tree** — every node, every point back, every granted item removed.
- **Dependents cascade.** Refunding a node that other taken nodes require has to
  take those back too, and the confirmation names every one of them before it
  happens. A tree left holding a node whose prerequisite is gone is a corrupt
  tree, and silently allowing it is worse than refusing.

---

## 9. Deliberately not in scope

- **Player respec** — decided against, section 0.
- **OR-prerequisites.** `requiresAny` is reserved in the shape and unimplemented;
  every `requires` list means *all of them*. Wire it only if a tree actually
  wants it.
- **Granting anything but items** — no effects, no spell slots, no direct writes
  to `system.*`. A node grants a document or it grants text.
- **Bulk import.** Trees are authored in the editor.

---

## 10. Order of work

1. `world.mjs` — `WS.giftTrees`, read/write, seeding, `SCHEMA_VERSION` → 3.
2. `data.mjs` — composition and namespacing, the v1.11 actor-local migration,
   `grantGiftPoints`, refund and reset. Everything else reads this.
3. Grants — create and delete against PF2e, plus the verification pass in
   section 6.
4. The editor.
5. The viewer.
6. `api.mjs` — the new macro surface.
7. Tests, and the preview renderer, which has to grow a Gift-tree fixture or it
   will go on lying in the module's favour the way it did before v1.8.

---

## 11. Tests

Against the v1.11 suite's 434, the new checks:

- composition: two trees resolve to one namespaced graph; a cross-tree
  `requires` is honoured; an unassigned tree contributes nothing.
- migration: a v1.11 actor-local tree survives, keeps its unlocked nodes and
  its points, and runs once.
- the gate, again, through composition: requirements across a tree boundary,
  cost against the shared pool, `force` skipping both.
- cycle detection, unreachable nodes, dangling edges — the validation strip is
  test-covered logic, not a rendering detail.
- grants: created ids recorded; a dead UUID does not block the unlock and is
  reported; refund deletes exactly the recorded ids and nothing else.
- cascade refund: taking back a prerequisite takes back its dependents and
  returns every point.
- position clamping, as map pins already have.
- the GM tab coverage test picks up the rebuilt Gift tab, since it is driven off
  the exported `GM_TABS`.
