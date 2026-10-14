/**
 * Zenith Academy Scroll — the Gift tree
 *
 * A Gift starts as one thing a student can do and grows into a tree. Three
 * decisions shape everything here.
 *
 * **A student is on a list of trees, not one.** The common Awakening trunk that
 * everyone has and the personal branch assigned to them are two separate trees
 * in the world library, composed here into one graph. That is what lets a typo
 * in the trunk be fixed once rather than six times, while still letting two
 * students have nothing in common above it.
 *
 * **Node ids are namespaced by their tree** — `core:n4`, `emberpath:n1` — which
 * is what makes the composition more than two trees drawn side by side. A
 * branch's root can name a trunk node in its `requires`, so the branch grows out
 * of a chosen point on the trunk and the viewer draws one continuous board. The
 * student never perceives two trees.
 *
 * **Points are one pool.** Spent anywhere the student has access to, so going
 * deep on the trunk instead of racing into the branch is a real choice rather
 * than an accounting error.
 *
 * Imports data and world, so the direction stays core <- world <- data <- gift.
 */

import { M, app, uid } from "./core.mjs";
import {
  getGiftTrees, giftTreeById, saveGiftTree, schemaVersion, setSchemaVersion,
} from "./world.mjs";
import { getGiftTree, setGiftTree, pushNotification } from "./data.mjs";

/**
 * The pseudo-tree a pre-v1.12 actor-local tree is composed as.
 *
 * Reserved: `setGiftTrees` strips a leading `~` from a library id, so nothing in
 * the library can ever claim this and shadow a student's own legacy tree.
 */
export const LOCAL_TREE = "~local";

// ---------------------------------------------------------------------------
//  Namespacing
// ---------------------------------------------------------------------------

/** `core` + `n4` → `core:n4`. */
export function nsId(treeId, nodeId) {
  return `${treeId}:${nodeId}`;
}

/**
 * A `requires` entry as written, resolved against the tree it was written in.
 *
 * Bare means "in my own tree", which is what a GM dragging an edge inside one
 * tree produces and what every v1.11 tree contains. Already-qualified means the
 * edge crosses into another tree, which is how a branch hangs off the trunk.
 */
export function qualify(treeId, ref) {
  const s = String(ref);
  return s.includes(":") ? s : nsId(treeId, s);
}

/** One library node, projected into the composed graph. */
function project(treeId, node) {
  return {
    ...node,
    id: nsId(treeId, node.id),
    localId: String(node.id),
    tree: treeId,
    requires: (node.requires ?? []).map(r => qualify(treeId, r)),
  };
}

// ---------------------------------------------------------------------------
//  Composition
// ---------------------------------------------------------------------------

/**
 * Every node a student can see, as one graph.
 *
 * A tree that has been deleted from the library while a student was still
 * assigned to it contributes nothing rather than throwing — the assignment is
 * left alone, because a GM who deletes a tree by accident should be able to put
 * it back and find every student still on it.
 */
export function resolveGiftTree(actor) {
  const rec = getGiftTree(actor);
  const unlocked = new Set(rec.unlocked);
  const nodes = [];
  const sources = [];

  for (const id of rec.trees) {
    const t = giftTreeById(id);
    if (!t) continue;
    sources.push({ id: t.id, name: t.name, missing: false });
    for (const n of t.nodes) nodes.push(project(t.id, n));
  }

  // A pre-v1.12 tree stored on the student. Composed as its own tree so the
  // rest of this file has exactly one shape to reason about.
  if (rec.nodes.length) {
    sources.push({ id: LOCAL_TREE, name: "Gift", missing: false });
    for (const n of rec.nodes) nodes.push(project(LOCAL_TREE, n));
  }

  const byId = new Map(nodes.map(n => [n.id, n]));

  /*
   * Legacy `unlocked` entries are bare node ids, because v1.11 had nothing to
   * namespace them against. They are honoured only for nodes in the legacy
   * tree: honouring them everywhere would let a student who once took `n1`
   * arrive already holding `n1` in every library tree they are later assigned.
   */
  const taken = n => unlocked.has(n.id) || (n.tree === LOCAL_TREE && unlocked.has(n.localId));
  for (const n of nodes) n.taken = taken(n);

  const spent = nodes.reduce((sum, n) => sum + (n.taken ? n.cost : 0), 0);

  return {
    nodes, byId, sources,
    unlocked: rec.unlocked,
    points: rec.points,
    granted: rec.granted,
    spent,
  };
}

/**
 * What a node looks like to the student right now.
 *
 * "Locked by requirements" and "locked by cost" are deliberately different
 * states rather than one greyed-out node: *you have not earned the right to
 * this* and *you cannot afford this yet* are different messages, and a tree
 * that conflates them reads as arbitrary.
 */
export function giftNodeState(graph, node) {
  if (node.taken) return "taken";
  const missing = node.requires.filter(r => {
    const dep = graph.byId.get(r);
    return !dep?.taken;
  });
  if (missing.length) return "locked-req";
  if (node.cost > graph.points) return "locked-cost";
  return "affordable";
}

/** The taken nodes that depend on this one, transitively. */
export function dependentsOf(graph, nodeId) {
  const out = [];
  const seen = new Set([String(nodeId)]);
  let frontier = [String(nodeId)];

  while (frontier.length) {
    const next = [];
    for (const n of graph.nodes) {
      if (seen.has(n.id) || !n.taken) continue;
      if (n.requires.some(r => frontier.includes(r))) {
        seen.add(n.id);
        out.push(n);
        next.push(n.id);
      }
    }
    frontier = next;
  }
  return out;
}

// ---------------------------------------------------------------------------
//  Validation
// ---------------------------------------------------------------------------

/**
 * What makes a tree unplayable, as opposed to merely ugly.
 *
 * Logic rather than a rendering detail, so the editor's strip and the test
 * suite read the same answers. Takes projected nodes, so it works on one tree
 * or on a whole composition.
 */
export function validateGiftGraph(nodes) {
  const problems = [];
  const byId = new Map();

  for (const n of nodes) {
    if (byId.has(n.id)) {
      problems.push({ level: "error", node: n.id, message: `duplicate node id "${n.localId}"` });
      continue;
    }
    byId.set(n.id, n);
  }

  for (const n of nodes) {
    if (!String(n.name).trim()) {
      problems.push({ level: "warn", node: n.id, message: "node has no name" });
    }
    for (const r of n.requires) {
      if (!byId.has(r)) {
        problems.push({
          level: "error", node: n.id,
          message: `requires "${r}", which does not exist`,
        });
      }
    }
  }

  // --- cycles: A needs B needs A, and neither can ever be taken ---
  const WHITE = 0, GREY = 1, BLACK = 2;
  const colour = new Map([...byId.keys()].map(k => [k, WHITE]));
  const visit = (id, path) => {
    colour.set(id, GREY);
    for (const r of byId.get(id)?.requires ?? []) {
      if (!byId.has(r)) continue;
      if (colour.get(r) === GREY) {
        problems.push({
          level: "error", node: id,
          message: `circular requirement: ${[...path, id, r].join(" → ")}`,
        });
      } else if (colour.get(r) === WHITE) {
        visit(r, [...path, id]);
      }
    }
    colour.set(id, BLACK);
  };
  for (const id of byId.keys()) if (colour.get(id) === WHITE) visit(id, []);

  // --- reachability: a node no sequence of legal unlocks can ever arrive at ---
  const takeable = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) {
      if (takeable.has(n.id)) continue;
      if (n.requires.every(r => takeable.has(r))) { takeable.add(n.id); grew = true; }
    }
  }
  for (const n of nodes) {
    if (!takeable.has(n.id)) {
      problems.push({ level: "error", node: n.id, message: "no legal path ever reaches this node" });
    }
  }

  return problems;
}

/** One library tree, validated against the whole library so cross-tree edges resolve. */
export function validateGiftTree(treeId, trees = getGiftTrees()) {
  const all = [];
  for (const t of trees) for (const n of t.nodes ?? []) all.push(project(t.id, n));
  const mine = new Set((giftTreeById(treeId)?.nodes ?? []).map(n => nsId(treeId, n.id)));
  return validateGiftGraph(all).filter(p => !p.node || mine.has(p.node));
}

/**
 * The grants in a tree whose UUID no longer resolves.
 *
 * Separate from `validateGiftTree` because it is the only check that has to go
 * to the database, and the editor's strip should not wait on a compendium to
 * tell a GM about a cycle.
 */
export async function deadGrants(treeId) {
  const tree = giftTreeById(treeId);
  const out = [];
  for (const n of tree?.nodes ?? []) {
    for (const g of n.grants ?? []) {
      let doc = null;
      try { doc = await fromUuid(g.uuid); } catch (e) { doc = null; }
      if (!doc) out.push({ node: n.id, name: n.name, grant: g });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
//  Grants
// ---------------------------------------------------------------------------

/**
 * Create what a node hands over.
 *
 * The student owns their own actor, so this needs no GM relay — the same path
 * `grantCurrency` already takes for a missing currency item.
 *
 * A UUID that no longer resolves must not block the unlock. The node is taken,
 * the points are spent, and the failure is reported: "she has never been paid"
 * and "she cannot be paid" are different problems, and the second one is the
 * GM's to fix, not a reason to refuse a student the node they earned.
 */
export async function applyGrants(actor, node) {
  const made = [], failed = [];

  for (const g of node.grants ?? []) {
    try {
      const doc = await fromUuid(g.uuid);
      if (!doc) { failed.push(g); continue; }
      const data = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
      delete data._id;
      const created = await actor.createEmbeddedDocuments("Item", [data]);
      for (const c of created ?? []) if (c?.id) made.push(String(c.id));
    } catch (e) {
      console.warn(`${M} | gift: could not grant ${g.uuid} to ${actor.name}`, e);
      failed.push(g);
    }
  }

  return { made, failed };
}

/** Take back exactly what an unlock created — by id, never by name. */
export async function removeGrants(actor, ids) {
  const want = (ids ?? []).map(String);
  if (!want.length || !actor?.deleteEmbeddedDocuments) return 0;

  const has = id => (actor.items?.get?.(id) ?? actor.items?.find?.(i => String(i.id) === id)) ? id : null;
  const present = want.map(has).filter(Boolean);
  if (!present.length) return 0;

  try {
    await actor.deleteEmbeddedDocuments("Item", present);
  } catch (e) {
    console.warn(`${M} | gift: could not remove granted item(s) from ${actor.name}`, e);
    return 0;
  }
  return present.length;
}

// ---------------------------------------------------------------------------
//  Taking a node
// ---------------------------------------------------------------------------

/**
 * Take a node, if its requirements are met and it is paid for.
 *
 * The order matters: **the grants are created before the points are spent.** A
 * PF2e item carrying a ChoiceSet opens a dialog when it is created, and a
 * student who cancels that dialog must not have already been charged for it.
 *
 * `force` is for a GM granting something outside the rules, which happens more
 * often than a tree admits.
 */
export async function unlockGiftNode(actor, nodeId, { force = false, spend = true } = {}) {
  if (!actor?.isOwner) return { ok: false, why: "not yours to write" };

  const graph = resolveGiftTree(actor);
  const want = String(nodeId);
  // Addressable by its full id, or bare when it is unambiguous — a GM typing
  // `zs.unlockGift("Rin", "n4")` into a macro should not have to know the
  // namespacing exists.
  const matches = graph.nodes.filter(n => n.id === want || n.localId === want);
  if (!matches.length) return { ok: false, why: "no such node" };
  if (matches.length > 1) {
    return { ok: false, why: `"${want}" is ambiguous: ${matches.map(n => n.id).join(", ")}` };
  }

  const node = matches[0];
  if (node.taken) return { ok: false, why: "already taken" };

  if (!force) {
    const missing = node.requires.filter(r => !graph.byId.get(r)?.taken);
    if (missing.length) return { ok: false, why: "requires " + missing.join(", ") };
    if (spend && node.cost > graph.points) {
      return { ok: false, why: `costs ${node.cost}, has ${graph.points}` };
    }
  }

  const { made, failed } = await applyGrants(actor, node);

  const rec = getGiftTree(actor);
  rec.unlocked.push(node.id);
  if (spend && !force) rec.points = Math.max(0, rec.points - node.cost);
  if (made.length) rec.granted[node.id] = made;
  await setGiftTree(actor, rec);

  await pushNotification(actor, {
    icon: "fa-diagram-project",
    title: node.name || "Gift unlocked",
    body: node.effect || node.description || "",
    app: "gift",
  });

  if (failed.length) {
    console.warn(`${M} | gift: ${actor.name} took "${node.name}" but ${failed.length} grant(s) could not be created`);
    ui.notifications?.warn?.(
      `"${node.name}" was unlocked, but ${failed.length} of its grants could not be found. The GM will need to add them by hand.`);
  }

  app.ui?.refresh();
  return { ok: true, node, granted: made, failedGrants: failed };
}

// ---------------------------------------------------------------------------
//  Undo — GM only
// ---------------------------------------------------------------------------

/**
 * Give a node back.
 *
 * Cascades, and has to: a tree left holding a node whose prerequisite is gone
 * is a corrupt tree, and silently allowing it is worse than refusing. The
 * caller is expected to have named the dependents to the GM first — `preview`
 * returns them without writing anything.
 */
export async function refundGiftNode(actor, nodeId, { preview = false } = {}) {
  if (!actor?.isOwner) return { ok: false, why: "not yours to write" };

  const graph = resolveGiftTree(actor);
  const want = String(nodeId);
  const node = graph.nodes.find(n => (n.id === want || n.localId === want) && n.taken);
  if (!node) return { ok: false, why: "not taken" };

  const going = [node, ...dependentsOf(graph, node.id)];
  const refund = going.reduce((sum, n) => sum + n.cost, 0);
  if (preview) return { ok: true, nodes: going, refund };

  const rec = getGiftTree(actor);
  for (const n of going) {
    await removeGrants(actor, rec.granted[n.id]);
    delete rec.granted[n.id];
    rec.unlocked = rec.unlocked.filter(u => u !== n.id && !(n.tree === LOCAL_TREE && u === n.localId));
  }
  rec.points += refund;
  await setGiftTree(actor, rec);

  app.ui?.refresh();
  return { ok: true, nodes: going, refund };
}

/** Every node back, every point back, every granted item removed. */
export async function resetGiftTree(actor) {
  if (!actor?.isOwner) return { ok: false, why: "not yours to write" };

  const graph = resolveGiftTree(actor);
  const rec = getGiftTree(actor);
  let removed = 0;

  for (const ids of Object.values(rec.granted)) removed += await removeGrants(actor, ids);

  rec.points += graph.spent;
  rec.unlocked = [];
  rec.granted = {};
  await setGiftTree(actor, rec);

  app.ui?.refresh();
  return { ok: true, refund: graph.spent, items: removed, nodes: graph.nodes.filter(n => n.taken).length };
}

// ---------------------------------------------------------------------------
//  Migration
// ---------------------------------------------------------------------------

/**
 * Lift pre-v1.12 actor-local trees into the library, once.
 *
 * Each student who has one gets their own library tree rather than being merged
 * into a shared one: two students holding trees that happen to share node ids
 * are not holding the same tree, and guessing that they are would silently
 * rewrite someone's progression. A GM who wanted them shared can duplicate and
 * reassign in the editor, which is a two-click job and cannot lose anything.
 *
 * The old `nodes` array is cleared only after the library write succeeds, so an
 * interrupted migration leaves the student on the tree they already had.
 */
export async function migrateGiftTrees() {
  if (!game.user.isGM) return 0;
  if (schemaVersion() >= 3) return 0;

  let n = 0;
  for (const u of game.users.filter(u => !u.isGM && u.character)) {
    const actor = u.character;
    const rec = getGiftTree(actor);
    if (!rec.nodes.length) continue;

    const id = `gift-${actor.id}`;
    await saveGiftTree({
      id,
      name: `${actor.name}'s Gift`,
      note: "Lifted out of actor flags by the v1.12 migration.",
      nodes: rec.nodes,
    });

    rec.trees = [...new Set([...rec.trees, id])];
    rec.unlocked = rec.unlocked.map(x => (String(x).includes(":") ? String(x) : nsId(id, x)));
    rec.nodes = [];
    rec.tiers = [];
    await setGiftTree(actor, rec);

    console.log(`${M} | v1.12: lifted ${actor.name}'s Gift tree into the library as "${id}"`);
    n++;
  }

  await setSchemaVersion(3);
  return n;
}

/** A blank tree for the editor's "new tree" button. */
export function newGiftTree(name = "New tree") {
  return { id: uid("tree").replace(/:/g, "-"), name, note: "", nodes: [] };
}
