# v1.8 — plan

> **STATUS: BUILT.** Shipped as v1.8.0. Sections 1-6 and the order of work in
> section 8 are all done; see `CHANGELOG.md` for what landed and the v1.8 section
> of `zen-scroll-handoff.md` for the invariants it introduced.
>
> Two things here were deliberately *not* built, and both are noted in the
> handoff: **section 7's brainstorm**, which was explicitly beyond the ask, and
> **item 10 of section 8 (C2, UUID keying)**, which is listed in the order of
> work but carries no design anywhere in this document — it needs a schema
> migration and a decision about existing data, not a footnote to a layout
> release.
>
> One bug this plan did not predict was found during the browser pass: three
> form controls were `content-box` at `width: 100%`, so the scroller was clipping
> the right border off the device-name field, the reply composer and the contact
> notes textarea.
>
> Kept as written below, as the record of what was decided and why.

Everything here is **planned, not built**. v1.7 is the current state of the repo.
Written at the end of the v1.7 session so the next one can pick straight up.

Requested: fix overlapping elements, bigger projection, centre everything,
password-locked "clear all data", per-notification dismiss, brighter SCROLL
label, remove the status bar, a Bank app for Astras + Marks, bigger text, and
token images instead of portrait art.

---

## 0. Decisions — answered, no longer open

All six settled at the end of the v1.7 session.

| # | Question | Decision |
|---|---|---|
| 1 | Which overlap? | **The lock screen.** Root cause found — section 1a. |
| 2 | Token images | **Confirmed**: use `actor.prototypeToken.texture.src`. |
| 3 | Notification bell | **Your call either way** → going with the Alerts app. Section 3. |
| 4 | Danger Zone approach | **My recommendation**, and it's low priority — see below. |
| 5 | Bank | App is called **"Bank"**. Astras and Marks both use `system.quantity`. |
| 6 | Clear scope | **All stored scroll data.** Reading noted below. |

Two notes on how I've read the looser answers, so you can correct me:

- **(4) is now low priority.** You host locally and players connect to you, so
  they cannot play while you are offline — which means the accidental-wipe risk
  is small and entirely yours. I've moved Danger Zone to last, and since you're
  on localhost `crypto.subtle` will be available to you anyway; the pure-JS
  fallback stays in as belt-and-braces for the day you move to a hosted service.
- **(6) "all the stored data in the scrolls"** — I'm reading that as every
  per-actor flag the module writes: profile, academic, social, media, system,
  prefs. **Not** the world notices and calendar, because those are the school's
  content rather than anything a scroll holds. They'll be a separate checkbox,
  defaulting to OFF. Say if you meant everything including those.
- **(2)** leaves the contact-detail portrait question from §7b unanswered, so
  I'm taking my own recommendation: token images for the four circular avatars,
  and `actor.img` kept for the 96×118 contact detail panel, which is the one
  place the large key art earns its space. Easy to flip if you disagree.

---

## 1. Overlaps

1a is the one you reported — found by rendering the lock screen in a browser at
three panel heights and looking at it. The rest came from tracing every
absolutely-positioned element that escapes its box against every ancestor that
clips. Six real problems, in severity order.

### 1a. THE LOCK SCREEN CLIPS ITS OWN UNLOCK BUTTON  **[confirmed, this is the one you saw]**

I rendered the lock screen at panel heights of 780 / 640 / 520px and looked. At
520px the words **"TOUCH THE STONE" are sliced in half by the bottom edge of the
panel.** At 640px it fits but sits low. Only the 780px case looks right.

Root cause, and it is exactly one missing line:

```
.zsl-wrap {          /* css:700 */
  flex: 1;
  min-height: 0;
  ...                /* <-- no overflow rule at all */
}
```

`.zsl-open` uses `margin-top: auto` to push itself to the bottom. When the
content is taller than the space available, that auto margin collapses to zero
and the button simply overflows past the bottom of the wrap — where
`.zsu-screen`'s `overflow: hidden` and rounded corner slice straight through it.
Nothing scrolls, nothing shrinks, it is just cut off.

It bites harder than it looks because the **hidden dock still occupies its ~56px
of height** on the lock screen (it is `visibility: hidden`, not `display: none`),
so the usable stage is 56px shorter than the panel suggests.

Fix, in order of preference:

1. Give `.zsl-wrap` a real overflow strategy — `overflow-y: auto` plus
   `min-height: 0` so it scrolls rather than clips, as a floor under everything else.
2. Collapse the dock on lock (`display: none`) instead of hiding it, recovering 56px.
3. Make the lock screen's own spacing responsive: the 48px top padding, the 62px
   clock and the 22px rule margins are all fixed, and should shrink on short panels.
   The existing `@media (max-height: …)` blocks tune some of this but are keyed to
   the *viewport*, not the panel, so they miss when the panel is clamped.

All three, ideally. (1) is the one that guarantees nothing is ever cut off again.

### 1b. Centred text sits half a letter-space left of centre  **[identified from code]**

This is very likely the "not centered within borders" part, and it is systematic
rather than one bad rule. The stylesheet has **38 `letter-spacing` declarations**,
and most of them are on short uppercase labels that are centred — `RIN'S SCROLL`,
`TOUCH THE STONE`, `NEXT`, `TOMORROW`, the category headers, the settings labels.

CSS adds the letter-space **after the final character too**. So a centred line of
text with `letter-spacing: 3px` renders its glyphs 1.5px left of true centre, with
an invisible 3px gap on the right. Small individually; across a whole screen of
stacked centred labels it reads as "everything is slightly off".

Fix: a utility that cancels the trailing space on centred letter-spaced text —
`margin-right: -<letter-spacing>` on the element (or a shared class). Worth doing
as part of the type-token pass in section 2, since I'll be touching every one of
those declarations anyway.

I have *reasoned* this one from the code rather than measured it to the pixel —
the effect is a well-known CSS behaviour, but I want to confirm it against your
actual screen before calling it fixed.

### 1c. App-tile badges are clipped and crowd their neighbours  **[confirmed]**

`.zsn-badge` (css:932) is `top: -5px; right: -5px` on a tile in a 4-column grid
whose column gap is 6px. Two consequences: the badge on the **rightmost column**
is clipped by the same `overflow-x: hidden` scroller, and elsewhere a badge
lands 1px from the neighbouring tile.

Fix: give the grid enough gap for the overhang (≥12px columns), pad the scroller
so the right column has room, or inset the badge to `top:-2px; right:-2px`.

### 1d. The close button sits outside the panel  **[confirmed]**

`.zsu-close` (css:410) is `top: -14px; right: -14px`, i.e. outside `.zsu-frame`.
It overlaps the outer bloom, and on a short viewport where the frame is already
clamped to `88vh` it can end up under the browser chrome. The lightbox close
(`.zslb-close`, css:2145) has the same shape at `-16px`.

Fix: move both inside their panel. With the status bar gone there is a natural
home for it in the app bar's trailing slot.

### 1e. Contact tooltips are clipped  **[confirmed]**

`.zsr-vn-tip` (css:1684) sits at `bottom: calc(100% + 8px)` — it escapes
*upward* out of the contact circle. Its ancestor `.zsu-scroller` (css:467) is
`overflow-y: auto; overflow-x: hidden`, which is a clipping context. So:

- the **top row** of every category has its tooltip cut off by the scroller
- the **left and right columns** have theirs cut horizontally

Same root shape as 1a: something positioned to escape its box, and an ancestor
that clips. Worth fixing them with the same eye.

Fix: do not rely on overflow escape. Either flip the tooltip below the circle
when it is in the first row, or — better and more robust — render the tooltip
into the view root and position it from the circle's `getBoundingClientRect()`,
so no ancestor can clip it.

### 1f. The emitter haze washes over the panel  **[likely]**

`.zsu-emitter` is a `position: fixed` 200px radial glow at the bracelet's stone.
If the bracelet is dragged near the centre of the screen, that glow sits on top
of the opening panel for its 1.1s animation. Harmless but muddy.

Fix: cap its opacity, or skip it when the stone is within the frame's rect.

### 1g. Systematic pass

Beyond those four, I want to re-render every view in the browser at three
viewport heights and look, the way I did in v1.7 — that's how the egg-shaped
bracelet and the Pro-only icon were caught, and neither showed up in tests.

---

## 2. Sizing, centring and type

### Bigger projection

Currently `430 × 780`, `max-width: 94vw`, `max-height: 88vh` (css:296).
Proposal: **`480 × 880`**, `max-height: 92vh`.

Caveat worth stating: on a 1080p screen Foundry's viewport is often ~900 CSS px
tall, so 880 is already at the clamp and the *nominal* number does little — the
`vh` cap is what you'll actually see. Getting a genuinely bigger feel means
raising the cap **and** enlarging type and spacing together, which is why this
and "bigger text" are one job, not two.

### Bigger text — introduce type tokens first

Type sizes are hardcoded across ~20 distinct px values (12.5, 11, 10, 9.5, 9,
8.5 …). Bumping them one by one invites drift. Plan: define a type scale in
`:root` —

```
--zt-2xs --zt-xs --zt-sm --zt-base --zt-lg --zt-xl --zt-2xl
```

— convert the stylesheet to use it, then raise the scale once. Roughly +1 to
+1.5px at the small end, more at the top. Micro-labels currently at 8–8.5px are
the worst offenders and should not go below 10px.

### Centring

`#zs-ui` centres the frame itself; the question is content inside. Things to
check and likely fix:

- **`.zsu-dock`** uses `justify-content: space-around` with `flex: 1` children
  *and* a `max-width` — that combination distributes unevenly. Should be
  `space-evenly` or a fixed gap with centred content.
- **`.zsu-appbar`** centres its title between a 30px back button and a 30px
  spacer, which balances only while the trailing control is exactly 30px. The
  Messages thread header replaces the title with an avatar block, so it isn't
  centred there. Needs a proper three-column grid, not flex guesswork.
- **`.zsn-head`** and **`.zsh-card`** are left-aligned by design. Tell me if you
  want those centred too — it's a taste call, and centring them changes the
  Student ID card a lot.

---

## 3. Removing the status bar

Straightforward to delete (`_statusBar()` in ui-scroll, css section 5), but it
carries four things and three of them need a new home.

| Was in the bar | Plan |
|---|---|
| Clock | Drop. The lock screen already has a large one. |
| Charge meter | Drop — pure flavour, and that's the point of removing the bar. |
| **Notification bell** | Needs a home — see below. |
| **Aether signal** | Needs a home — see below. |

**Notification bell → Alerts becomes the 9th app.** You said either was fine, so
I am taking the grid option: it removes the bar cleanly, gets a badge for free,
needs no gesture, and keeps the dock's four pins intact.

Cheap addition worth doing at the same time: a small bell button in the **Home
header** (`.zsn-head`, top-right), so the badge is visible the moment you unlock
without having to spot it in the grid. That gets you most of "keep the bell in
the top" without bringing the bar back.

**App count after v1.8**: 10 — Student ID, Messages, Contacts, Notices,
Schedule, Gift, Gallery, Settings, **Alerts**, **Bank**. At 4 columns that is 3
rows with 2 empty slots, which is normal for a phone and leaves room to grow.
With the panel going to 480px wide the tiles can grow from 52px to ~62px, which
also serves the "make things bigger" ask.

**Aether signal → inline strip in Messages.** Shown only when no GM is connected.
Worth noting your own answer to (4) makes this *less* critical than I thought:
if players cannot play at all while you are offline, they will rarely see it. But
it still fires when you are connected and your client is mid-reload, so it stays.

Once the bar is gone the app bar becomes the topmost element, which is where the
close button should move (see 1c).

---

## 4. Password-locked "clear all scroll data"  *(low priority — do last)*

**You have said this is low priority** — you host locally and players connect
to you, so they cannot play while you are offline and the accidental-wipe risk is
yours alone. It moves to last in the order. Building it as recommended.

A passphrase here is a **misclick guard, not security**. World settings sync to every connected client, so the passphrase
must be stored as a salted hash (`crypto.subtle.digest`), never plaintext — and
even then, anyone with a browser console and GM rights can bypass the dialog.
What actually stops a player wiping the campaign is Foundry's permission model:
a player cannot write another actor's flags at all. The passphrase stops *you*
(or a co-GM) doing it by accident at 1am. I'll build it, I just don't want it
sold to you as more than it is.

Plan:

- World setting `resetHash` (`config: false`) holding salt + SHA-256.
- **Danger Zone** section in the Command Center, GM-only:
  - Set / change passphrase
  - **Export all scroll data to JSON first** — I'd make this the default path
    and strongly recommend you take the backup. Cheap to build, and the only
    real undo.
  - Clear All Scroll Data → DialogV2 requiring the passphrase **and** typing
    `DELETE`, listing exactly what will be removed and for how many actors.
- Scope: **all stored scroll data** by default — every per-actor flag the module
  writes (`profile`, `academic`, `social`, `media`, `system`, `prefs`) across
  every actor. World notices + calendar are a **separate checkbox, default OFF**,
  on the reading that they are the school's content and not something a scroll
  holds. Finer-grained checkboxes (messages only, gallery only) are a
  nice-to-have, not required.
- Unsets the module's flags per actor rather than writing empty objects, so the
  actors come back genuinely clean.

---

## 5. Smaller, well-defined items

### Per-notification dismiss
Add an `×` to `.zsy-row`, plus `dismissNotification(actor, id)` in `data.mjs`
next to `clearNotifications`. Keep the bulk "Clear log". Written silently.

### Brighter SCROLL label
`.zsi-label` (css:~150) is `--zd-gold-dark` (#9a7020) at 0.75 opacity, 7px — dim
against a bright scene. Change to near-white `#eaf6f7`, full opacity, ~8px, with
`text-shadow: 0 1px 3px rgba(0,0,0,.9)` so it stays legible over *any* map, not
just dark ones. Optional: show the student's device name instead of "SCROLL".

### Token image instead of portrait art
Single behavioural change, 8 call sites. Add `portraitOf(actor)` to `data.mjs`:

```
actor.prototypeToken?.texture?.src  →  actor.img  →  placeholder
```

Then route these through it — `data.mjs:50` (`resolvePortrait`),
`ui-scroll.mjs:649` (home header), `:695` (Student ID card), `:1138` (message
picker), `:1168` (cohort auto-populate), `ui-gm.mjs:475` and
`zenith-scroll.mjs:199` (both "add as contact"). Add a world setting
`useTokenImages` (default on) so it can be flipped back without a code change.
Note the two "add as contact" sites *store* the image on the relationship
record, so existing contacts keep the old art until re-added — worth a one-time
migration or a "refresh portraits" button.

---

## 6. Bank app — Astras and Marks

`getMarks()` reads one item name from a setting. Generalise to a currency list.

- World setting `currencies`, an array of
  `{ key, itemName, label, icon, tint }`, defaulting to Marks + Astras.
- `getCurrency(actor, key)` and `getBalances(actor)` in `data.mjs`, replacing
  `getMarks` (keep `getMarks` as a thin alias so nothing breaks).
- **Bank app** (that is the name — confirmed). A balance card per currency with
  a large figure, the tint and icon from the setting.
- Student ID's MARKS stat becomes whichever currency is marked primary.

**Worth doing at the same time, because it's what makes the app more than a
read-out:** a ledger. `zs.grant(actor, "astras", 50, "Tournament prize")` in the
macro API would change the item quantity, append a dated line to a ledger on
actor flags, and raise a notification. That gives the Bank a history to show and
starts to answer the roadmap's standing "Marks is a currency with no surface"
problem. Say if you'd rather keep v1.8 read-only.

**Confirmed**: Astras and Marks are both stored as `system.quantity` on an
inventory item, exactly as Marks is read today — so no configurable path is
needed. I will still fail soft to 0 rather than throw if an item is missing or
renamed.

---

## 7. Brainstorm — beyond what you asked for

Ordered by what I think earns its place soonest.

1. **Requisition / store app.** The natural partner to Bank: a short list of
   things students can spend on (exam retakes, dorm upgrades, favours), each
   with a price and a "request" button that messages you. Gives currency a sink
   without you having to invent an economy.
2. **Do Not Disturb.** `statusPreset` is *still* stored and never read — it has
   been dead since v1.5. Wiring it to a presence picker (Available / Busy /
   Away / Do Not Disturb) that suppresses toasts is nearly free now that mute
   exists, and it shows on your contact card to the rest of the cohort.
3. **Rank-up moment.** An animated confidant-style card when a relationship rank
   changes, instead of the number quietly moving. This is the single most
   Persona thing left undone, and the machinery (`adjustRelationship` already
   knows the old and new rank) is in place.
4. **Home-screen widget row.** One card above the app grid: next class, or the
   event countdown, or the newest notice. Makes Home informative rather than a
   launcher.
5. **Group chat from the picker.** Multi-select in the New Conversation picker.
   Group chats currently only exist if you make them in the Command Center.
6. **Thread search.** Cheap, and increasingly needed as threads accumulate.
7. **Directory vs Contacts.** A read-only school roster app, separate from the
   personal relationship panel — so meeting someone can *add* them to Contacts,
   and unmet people can show as silhouettes.
8. **Campus map app.** Pins on an image. Wants an image asset, which breaks the
   no-binary-assets rule — flagging that, same as the sound question.
9. **Per-contact chime.** Very Persona, but blocked on the sound decision below.

**Still-open decision from v1.7:** sound. The module ships no binary assets by
design. Either WebAudio-synthesised tones (keeps the rule, thinner palette) or
four small files (breaks the rule, sounds better). Your call.

---

## 7b. Feasibility — checked, not assumed

All of it is buildable. Four things are harder or worse than section 0–7
implies, and one needs a different approach than written.

### The passphrase hash needs a fallback  **[confirmed — now low impact]**

*Settled:* you host locally, so `crypto.subtle` will be available on your own
client and this never bites you in practice. The fallback stays in for the day
you move to a hosted service. Original finding below, unchanged.


`crypto.subtle` is **only exposed in a secure context** — HTTPS, localhost or
file://. Plenty of Foundry tables run over plain HTTP on a LAN address
(`http://192.168.x.x:30000`), where `crypto.subtle` is simply `undefined`. If
the GM connects that way, SHA-256 hashing throws and the Danger Zone is dead.

Plan: try `crypto.subtle.digest`, and fall back to a small pure-JS string hash
when it's unavailable. That fallback is not cryptographic — which changes
nothing in practice, because as noted in section 4 this was never security. It
is a guard against a 1am misclick, and a weak hash guards against that exactly
as well as a strong one. Worth knowing rather than discovering at build time.

### Token images will break one portrait frame  **[confirmed]**

There are five portrait frames, and they are not all circles:

| Frame | Size | Shape | Token image? |
|---|---|---|---|
| Home header | 46×46 | circle | fine |
| Message avatar | 42×42 | circle | fine |
| Contact grid | 54×54 | circle | fine |
| Student ID card | 74×74 | rounded square | mostly fine |
| **Contact detail** | **96×118** | **tall rectangle** | **crops badly** |

The detail panel uses `object-fit: cover` on a 96×118 portrait rectangle. A
square token image put through that gets its left and right sliced off, and any
ring or border baked into the token art gets cut through. Transparent corners
will also show the panel behind them in the two non-circular frames.

Two ways out, pick one:
- **Make the detail portrait a circle too** (or a square), so tokens fit
  everywhere and the app is visually consistent. Changes how that screen looks.
- **Keep `actor.img` for the detail panel only**, and use token images for the
  four small circular avatars. Preserves the big VN-style key art, which is
  arguably the whole point of that screen.

**Going with the second** (no objection raised): token images for the four
circular avatars, `actor.img` kept for the 96×118 contact detail panel. That
panel is the one place large character art earns its space and it is the
strongest screen in the module. It does mean "token images everywhere" is not
literally what ships — flip it any time if you would rather have consistency.

### The type refactor is the biggest single chunk  **[measured]**

**121 font declarations across 2542 lines.** Mechanical, but large, and a
mistake in it is invisible except by looking at every screen — which is exactly
the class of bug that only the browser pass catches. Budget it as its own job,
not a footnote to "make text bigger", and re-render every view afterwards.

### "Bigger screen" is capped by the viewport, not the CSS

Restating from section 2 because it's the one place expectation and result can
diverge: on a 1080p display Foundry's viewport is often ~900 CSS px tall, so the
panel already sits at its `vh` clamp. Raising 780→880 changes little on its own.
The perceived size comes from the type scale and spacing going up with it, which
is why these are one job.

### Astras — confirmed, no longer a risk

Both Astras and Marks store their amount in `system.quantity` on an inventory
item, so the existing `getMarks` shape generalises directly. No configurable
path needed.

### Scope

Realistically three passes, not one:

1. Layout + centring + type tokens + status-bar removal (the big one)
2. Small wins + Bank
3. Danger Zone + export

Nothing here is blocked, and nothing needs a decision from anyone but you.

---

## 8. Order of work

Three passes. Pass 1 is what you actually asked for; 2 and 3 are additive.

### Pass 1 — layout, and the bug you saw
1. **Fix the lock screen clipping** (1a). Smallest, highest-value change here,
   and it is the concrete defect rather than a refactor. Do it first and alone
   so it is verifiable on its own.
2. **Type tokens** (2) — 121 declarations. Mechanical but big; land it before
   anything new gets styled, and cancel the letter-spacing trailing gap (1b)
   in the same sweep.
3. **Bigger panel** 430×780 → 480×880, `max-height: 92vh`, tiles 52 → 62px.
4. **Remove the status bar**; add the Alerts app and the Home-header bell; add
   the aether warning strip to Messages.
5. **Remaining overlaps**: contact tooltips (1e), tile badges (1c), close button (1d),
   emitter haze (1f). Centring audit on the dock and the app bar.
6. **Browser pass at three panel heights on every view.** Non-negotiable — it is
   what caught the egg bracelet, the Pro-only icon and this lock screen bug, and
   none of the three showed up in the test suite.

### Pass 2 — the additions
7. Small wins: brighter SCROLL label, per-notification dismiss, token images.
   All independent; can be done any time, including before pass 1.
8. **Bank app** + currency generalisation (+ the ledger, if you want it — say so).

### Pass 3 — housekeeping
9. **Danger Zone**: JSON export first, then the password-locked clear. Low
   priority by your own call.
10. **C2 (UUID keying)** — still top of the old roadmap, still unstarted.
    Renaming an actor detaches their conversations, portraits and relationship
    entry all at once, and it gets worse the longer the contact list grows.

Tests: `node tests/smoke.mjs` is at 134 checks and green. Extend rather than
replace — the fake DOM grew a real selector engine in v1.7 and can already
render every view.

**Important limitation to remember:** none of the layout bugs in section 1 are
catchable by that suite. It renders views and asserts structure, not geometry.
The browser pass is the only test for those, which is why step 6 is not optional.
