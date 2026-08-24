import type { GraphEdge, GraphNode, NodeHandle, WorkflowDefinition } from "../types/api";

/**
 * Pure helpers for the node graph. No React, no DOM and no React Flow types in
 * here: `test/graph.test.ts` imports this file directly with node's test
 * runner, the way `lib/fields.ts` is covered.
 *
 * Everything speaks the API's vocabulary — `nodeId`, `edgeId`, `sourceHandle`.
 * React Flow's `id` does not appear in this file and must not: the two
 * vocabularies meet in `components/WorkflowCanvas.tsx` and nowhere else.
 *
 * The definition is `nf_workflows.definition` (jsonb), so everything read from
 * the API is read defensively — a shape that moved must degrade to an empty
 * canvas, never to a crash on a screen the user cannot leave.
 */

export const EMPTY_DEFINITION: WorkflowDefinition = { nodes: [], edges: [] };

/** The type that starts every graph. Exactly one per definition. */
export const TRIGGER_TYPE = "trigger";

/** The default outgoing handle: every node type but the condition has just this. */
export const OUT_HANDLE = "out";

const HANDLES: readonly NodeHandle[] = ["out", "true", "false"];

/** What the canvas prints on a branch, and nothing on the plain `out`. */
export const HANDLE_LABELS: Record<string, string> = { true: "Sí", false: "No" };

/**
 * `[A-Za-z0-9_-]{1,64}`, the API's `NODE_ID_PATTERN`, applied to both node and
 * edge ids. Every id this module mints has to clear it or the save is a 400.
 */
export const GRAPH_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readHandle(raw: unknown): NodeHandle {
  return typeof raw === "string" && (HANDLES as readonly string[]).includes(raw)
    ? (raw as NodeHandle)
    : OUT_HANDLE;
}

function readPosition(raw: unknown): { x: number; y: number } {
  if (!isRecord(raw)) return { x: 0, y: 0 };
  const { x, y } = raw;
  return {
    x: typeof x === "number" && Number.isFinite(x) ? x : 0,
    y: typeof y === "number" && Number.isFinite(y) ? y : 0,
  };
}

/**
 * `e-3`. NOT derived from the pair it connects: an id like `a->b` fails the
 * API's `[A-Za-z0-9_-]{1,64}` pattern, and one built by concatenating two
 * 64-character node ids fails its length. A counter cannot fail either.
 */
export function nextEdgeId(edges: GraphEdge[]): string {
  const taken = new Set(edges.map((edge) => edge.edgeId));
  for (let n = 1; ; n += 1) {
    const candidate = `e-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * `definition` as it comes back from the API. Anything malformed collapses to
 * an empty graph, and individual nodes/edges that cannot be read are dropped
 * rather than poisoning the whole canvas. Edges pointing at a node that is not
 * in the list go too — React Flow throws on a dangling edge.
 */
export function normalizeDefinition(raw: unknown): WorkflowDefinition {
  if (!isRecord(raw)) return { ...EMPTY_DEFINITION };

  const nodes: GraphNode[] = [];
  const ids = new Set<string>();
  if (Array.isArray(raw.nodes)) {
    for (const entry of raw.nodes) {
      if (!isRecord(entry)) continue;
      const { nodeId, type } = entry;
      if (typeof nodeId !== "string" || nodeId === "" || ids.has(nodeId)) continue;
      if (typeof type !== "string" || type === "") continue;
      ids.add(nodeId);
      nodes.push({
        nodeId,
        type,
        config: isRecord(entry.config) ? entry.config : {},
        position: readPosition(entry.position),
      });
    }
  }

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw.edges)) {
    for (const entry of raw.edges) {
      if (!isRecord(entry)) continue;
      const { source, target } = entry;
      if (typeof source !== "string" || typeof target !== "string") continue;
      if (!ids.has(source) || !ids.has(target)) continue;
      const edgeId =
        typeof entry.edgeId === "string" && GRAPH_ID_PATTERN.test(entry.edgeId)
          ? entry.edgeId
          : nextEdgeId(edges);
      if (seen.has(edgeId)) continue;
      seen.add(edgeId);
      edges.push({ edgeId, source, target, sourceHandle: readHandle(entry.sourceHandle) });
    }
  }

  return { nodes, edges };
}

/**
 * `email-2`: the type plus the lowest free number. Readable in `nf_node_runs`,
 * which is what a person debugging a run actually reads, and inside the API's
 * id pattern as long as the type name is (the four shipped types are).
 */
export function nextNodeId(nodes: GraphNode[], type: string): string {
  const safe = type.replace(/[^A-Za-z0-9_-]/g, "") || "node";
  const taken = new Set(nodes.map((node) => node.nodeId));
  for (let n = 1; ; n += 1) {
    const candidate = `${safe}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Adds a node at `position`, leaving the rest of the definition untouched. */
export function addNode(
  definition: WorkflowDefinition,
  type: string,
  position: { x: number; y: number },
  config: Record<string, unknown> = {},
): WorkflowDefinition {
  const node: GraphNode = { nodeId: nextNodeId(definition.nodes, type), type, config, position };
  return { nodes: [...definition.nodes, node], edges: definition.edges };
}

/** Removes a node and every edge that touched it — a dangling edge is a crash. */
export function removeNode(definition: WorkflowDefinition, nodeId: string): WorkflowDefinition {
  return {
    nodes: definition.nodes.filter((node) => node.nodeId !== nodeId),
    edges: definition.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
  };
}

/** Replaces one node's config; used by every input of the generated panel. */
export function patchNodeConfig(
  definition: WorkflowDefinition,
  nodeId: string,
  config: Record<string, unknown>,
): WorkflowDefinition {
  return {
    nodes: definition.nodes.map((node) => (node.nodeId === nodeId ? { ...node, config } : node)),
    edges: definition.edges,
  };
}

/** Moves one node, which is the only thing dragging changes. */
export function moveNode(
  definition: WorkflowDefinition,
  nodeId: string,
  position: { x: number; y: number },
): WorkflowDefinition {
  return {
    nodes: definition.nodes.map((node) => (node.nodeId === nodeId ? { ...node, position } : node)),
    edges: definition.edges,
  };
}

/**
 * The three refusals the API makes about a single connection, so the canvas can
 * make them while the wire is still being dragged instead of after a round trip:
 *
 *  - a node cannot feed itself (a cycle of length one),
 *  - one outgoing edge per handle ("ya tiene una conexión desde la salida X"),
 *  - one incoming edge per node — joins are not supported ("no se admiten uniones").
 */
export function canConnect(
  definition: WorkflowDefinition,
  source: string,
  sourceHandle: NodeHandle,
  target: string,
): boolean {
  if (source === target) return false;
  if (
    definition.edges.some((edge) => edge.source === source && edge.sourceHandle === sourceHandle)
  ) {
    return false;
  }
  return !definition.edges.some((edge) => edge.target === target);
}

/** Adds the connection, or returns the definition untouched when it is refused. */
export function connect(
  definition: WorkflowDefinition,
  source: string,
  sourceHandle: NodeHandle,
  target: string,
): WorkflowDefinition {
  if (!canConnect(definition, source, sourceHandle, target)) return definition;
  return {
    nodes: definition.nodes,
    edges: [
      ...definition.edges,
      { edgeId: nextEdgeId(definition.edges), source, target, sourceHandle },
    ],
  };
}

/** Drops the given connections; React Flow reports removals one id at a time. */
export function removeEdges(
  definition: WorkflowDefinition,
  edgeIds: ReadonlySet<string>,
): WorkflowDefinition {
  return {
    nodes: definition.nodes,
    edges: definition.edges.filter((edge) => !edgeIds.has(edge.edgeId)),
  };
}

/** Every node the executor can walk to from the trigger. */
function reachableFrom(definition: WorkflowDefinition, start: string): Set<string> {
  const outgoing = new Map<string, string[]>();
  for (const edge of definition.edges) {
    const list = outgoing.get(edge.source);
    if (list === undefined) outgoing.set(edge.source, [edge.target]);
    else list.push(edge.target);
  }

  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const next of outgoing.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

/** Depth-first cycle check, mirroring the API's Kahn sort. */
function hasCycle(definition: WorkflowDefinition): boolean {
  const outgoing = new Map<string, string[]>();
  for (const edge of definition.edges) {
    const list = outgoing.get(edge.source);
    if (list === undefined) outgoing.set(edge.source, [edge.target]);
    else list.push(edge.target);
  }

  const OPEN = 1;
  const DONE = 2;
  const marks = new Map<string, number>();

  const visit = (nodeId: string): boolean => {
    const mark = marks.get(nodeId);
    if (mark === OPEN) return true;
    if (mark === DONE) return false;
    marks.set(nodeId, OPEN);
    for (const next of outgoing.get(nodeId) ?? []) {
      if (visit(next)) return true;
    }
    marks.set(nodeId, DONE);
    return false;
  };

  return definition.nodes.some((node) => visit(node.nodeId));
}

/**
 * The structural rules the API enforces on save, checked here first so the
 * message arrives before the round trip. Deliberately NOT a second opinion on
 * config validity: the node type's schema is the API's to enforce, and a copy
 * here would drift the moment a type changes.
 *
 * An empty graph is valid — a flow that only extracts fields has no nodes, and
 * the editor sends `definition: null` for it.
 */
export function validateDefinition(definition: WorkflowDefinition): string | null {
  if (definition.nodes.length === 0) return null;

  const triggers = definition.nodes.filter((node) => node.type === TRIGGER_TYPE);
  if (triggers.length === 0) return "El diagrama necesita un nodo de inicio.";
  if (triggers.length > 1) return "El diagrama sólo puede tener un nodo de inicio.";

  if (hasCycle(definition)) {
    return "El diagrama tiene un ciclo: las conexiones no pueden volver atrás.";
  }

  const trigger = triggers[0] as GraphNode;
  const reachable = reachableFrom(definition, trigger.nodeId);
  const orphan = definition.nodes.find((node) => !reachable.has(node.nodeId));
  if (orphan !== undefined) {
    return `El nodo "${orphan.nodeId}" no está conectado: nada lo alcanza desde el inicio.`;
  }

  return null;
}

/**
 * What actually gets saved. `null` rather than an empty definition: the API
 * refuses a graph with zero nodes and only skips parsing when the key is null.
 */
export function definitionForSave(definition: WorkflowDefinition): WorkflowDefinition | null {
  return definition.nodes.length === 0 ? null : definition;
}
