/*
 * Run with `npm test -w @mobius-modules/node-files` (node's built-in test
 * runner + native TS type stripping — no jest, no dependencies). Same setup as
 * `fields.test.ts`.
 *
 * Only the pure graph helpers: what the canvas reads out of the `definition`
 * jsonb, the ids it mints, the connections the API would refuse, and the
 * structural rules checked before the round trip. Rendering is verified in a
 * browser, not here.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GRAPH_ID_PATTERN,
  addNode,
  canConnect,
  connect,
  definitionForSave,
  moveNode,
  nextEdgeId,
  nextNodeId,
  normalizeDefinition,
  patchNodeConfig,
  removeEdges,
  removeNode,
  validateDefinition,
} from "../src/lib/graph.ts";
import type { WorkflowDefinition } from "../src/types/api.ts";

const node = (nodeId: string, type: string, x = 0) => ({
  nodeId,
  type,
  config: {},
  position: { x, y: 0 },
});

const chain = (): WorkflowDefinition => ({
  nodes: [node("trigger-1", "trigger"), node("email-1", "email", 240)],
  edges: [{ edgeId: "e-1", source: "trigger-1", target: "email-1", sourceHandle: "out" }],
});

test("normalizeDefinition reads nodeId/edgeId, never id", () => {
  // `sanitizeResponse` deletes every `id` key from every response body, so a
  // node keyed by `id` is exactly what a drifted API would send: anonymous.
  const withWrongKey = normalizeDefinition({
    nodes: [{ id: "trigger-1", type: "trigger" }],
    edges: [],
  });
  assert.deepEqual(withWrongKey.nodes, [], "a node without nodeId is not a node");

  const read = normalizeDefinition({
    nodes: [
      { nodeId: "trigger-1", type: "trigger" },
      { nodeId: "trigger-1", type: "trigger" },
      { nodeId: "", type: "email" },
      { type: "email" },
      {
        nodeId: "email-1",
        type: "email",
        position: { x: "10", y: 4 },
        config: { to: "a@b.c" },
      },
    ],
    edges: [{ source: "trigger-1", target: "email-1" }],
  });

  assert.equal(
    read.nodes.length,
    2,
    "the duplicate, the empty id and the id-less node are dropped",
  );
  assert.deepEqual(read.nodes[1]?.position, { x: 0, y: 4 }, "a non-numeric coordinate becomes 0");
  assert.deepEqual(read.nodes[1]?.config, { to: "a@b.c" });
  assert.equal(read.edges[0]?.edgeId, "e-1", "an edge with no edgeId gets a minted one");
  assert.equal(read.edges[0]?.sourceHandle, "out", "a missing handle is `out`, the API's default");
});

test("normalizeDefinition survives every other shape the column can hold", () => {
  assert.deepEqual(normalizeDefinition(null), { nodes: [], edges: [] });
  assert.deepEqual(normalizeDefinition("not a graph"), { nodes: [], edges: [] });
  assert.deepEqual(normalizeDefinition({ nodes: "no", edges: 3 }), { nodes: [], edges: [] });

  const handles = normalizeDefinition({
    nodes: [node("condition-1", "condition"), node("email-1", "email")],
    edges: [
      { edgeId: "e-1", source: "condition-1", target: "email-1", sourceHandle: "true" },
      { edgeId: "e-2", source: "condition-1", target: "email-1", sourceHandle: "sideways" },
    ],
  });
  assert.deepEqual(
    handles.edges.map((edge) => edge.sourceHandle),
    ["true", "out"],
    "an unknown handle falls back to `out` rather than reaching the API",
  );
});

test("an edge pointing at a node that is not there is dropped, not kept", () => {
  // React Flow throws on a dangling edge, so this is the difference between an
  // editable canvas and a screen the user cannot leave.
  const read = normalizeDefinition({
    nodes: [{ nodeId: "trigger-1", type: "trigger" }],
    edges: [
      { edgeId: "e-1", source: "trigger-1", target: "email-9" },
      { edgeId: "e-2", source: "ghost", target: "trigger-1" },
    ],
  });
  assert.deepEqual(read.edges, []);
});

test("every id this module mints clears the API's pattern", () => {
  // `[A-Za-z0-9_-]{1,64}`. An edge id derived from its endpoints ("a->b") does
  // not, and every save would come back 400.
  const nodeId = nextNodeId([], "condition");
  const edgeId = nextEdgeId([]);
  assert.match(nodeId, GRAPH_ID_PATTERN);
  assert.match(edgeId, GRAPH_ID_PATTERN);
  assert.match(nextNodeId([], "algo raro/2"), GRAPH_ID_PATTERN);

  const connected = connect(chain(), "email-1", "out", "trigger-1");
  for (const edge of connected.edges) assert.match(edge.edgeId, GRAPH_ID_PATTERN);
});

test("ids fill the first free slot instead of counting rows", () => {
  assert.equal(
    nextNodeId([node("email-1", "email"), node("email-3", "email")], "email"),
    "email-2",
  );
  assert.equal(nextNodeId([], "trigger"), "trigger-1");
  assert.equal(nextEdgeId(chain().edges), "e-2");
});

test("addNode leaves the edges alone and removeNode takes its edges with it", () => {
  const withNode = addNode(chain(), "http", { x: 480, y: 0 }, { method: "POST" });
  assert.equal(withNode.nodes.length, 3);
  assert.equal(withNode.edges.length, 1);
  assert.deepEqual(withNode.nodes[2]?.config, { method: "POST" }, "the schema's defaults are kept");

  const without = removeNode(withNode, "email-1");
  assert.deepEqual(
    without.nodes.map((entry) => entry.nodeId),
    ["trigger-1", "http-1"],
  );
  assert.deepEqual(without.edges, [], "the edge into the removed node goes with it");
});

test("patchNodeConfig and moveNode each touch exactly one node", () => {
  const patched = patchNodeConfig(chain(), "email-1", { to: "a@b.c" });
  assert.deepEqual(patched.nodes[1]?.config, { to: "a@b.c" });
  assert.deepEqual(patched.nodes[0]?.config, {});
  assert.deepEqual(patched.edges, chain().edges);

  const moved = moveNode(chain(), "trigger-1", { x: 9, y: 9 });
  assert.deepEqual(moved.nodes[0]?.position, { x: 9, y: 9 });
  assert.deepEqual(moved.nodes[1]?.position, { x: 240, y: 0 });
});

test("removeEdges drops only the ids it is given", () => {
  const two = connect(chain(), "email-1", "out", "trigger-1");
  const left = removeEdges(two, new Set(["e-1"]));
  assert.deepEqual(
    left.edges.map((edge) => edge.edgeId),
    ["e-2"],
  );
});

test("canConnect refuses exactly what the API refuses", () => {
  const base = chain();
  assert.equal(canConnect(base, "trigger-1", "out", "trigger-1"), false, "a node feeding itself");
  assert.equal(
    canConnect(base, "trigger-1", "out", "email-1"),
    false,
    "a second edge out of the same handle",
  );

  const branching: WorkflowDefinition = {
    nodes: [node("condition-1", "condition"), node("email-1", "email"), node("http-1", "http")],
    edges: [{ edgeId: "e-1", source: "condition-1", target: "email-1", sourceHandle: "true" }],
  };
  assert.equal(
    canConnect(branching, "condition-1", "false", "http-1"),
    true,
    "the other branch of the same condition is a different handle",
  );
  assert.equal(
    canConnect(branching, "condition-1", "false", "email-1"),
    false,
    "a node may not receive two edges — joins are not supported",
  );

  // A refused connection leaves the definition untouched, by identity.
  assert.equal(connect(branching, "condition-1", "false", "email-1"), branching);
});

test("an empty graph is valid and saves as null", () => {
  assert.equal(validateDefinition({ nodes: [], edges: [] }), null);
  assert.equal(
    definitionForSave({ nodes: [], edges: [] }),
    null,
    "the API refuses a definition with zero nodes; null is how 'no graph' travels",
  );
  const real = chain();
  assert.equal(definitionForSave(real), real);
});

test("validateDefinition demands exactly one trigger", () => {
  assert.notEqual(validateDefinition({ nodes: [node("email-1", "email")], edges: [] }), null);
  assert.notEqual(
    validateDefinition({
      nodes: [node("trigger-1", "trigger"), node("trigger-2", "trigger")],
      edges: [],
    }),
    null,
  );
  assert.equal(validateDefinition(chain()), null);
});

test("validateDefinition refuses a cycle the executor could not walk", () => {
  const cyclic: WorkflowDefinition = {
    nodes: [node("trigger-1", "trigger"), node("http-1", "http"), node("email-1", "email")],
    edges: [
      { edgeId: "e-1", source: "trigger-1", target: "http-1", sourceHandle: "out" },
      { edgeId: "e-2", source: "http-1", target: "email-1", sourceHandle: "out" },
      { edgeId: "e-3", source: "email-1", target: "http-1", sourceHandle: "out" },
    ],
  };
  assert.match(validateDefinition(cyclic) ?? "", /ciclo/);

  // The same graph without the back edge is fine — proof the check is finding
  // the cycle and not merely counting edges.
  assert.equal(validateDefinition({ nodes: cyclic.nodes, edges: cyclic.edges.slice(0, 2) }), null);
});

test("validateDefinition names a node the trigger cannot reach", () => {
  const orphaned: WorkflowDefinition = {
    nodes: [node("trigger-1", "trigger"), node("email-1", "email"), node("http-1", "http")],
    edges: [{ edgeId: "e-1", source: "email-1", target: "http-1", sourceHandle: "out" }],
  };
  // http-1 HAS an incoming edge, so "has a parent" is not the rule the API
  // applies: the pair is a component the trigger never reaches.
  assert.match(validateDefinition(orphaned) ?? "", /email-1|http-1/);
});
