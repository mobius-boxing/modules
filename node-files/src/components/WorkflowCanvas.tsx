import { useCallback, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
} from "@xyflow/react";
import type { Connection, Edge, EdgeChange, Node, NodeChange, NodeProps } from "@xyflow/react";
import {
  HANDLE_LABELS,
  OUT_HANDLE,
  addNode,
  canConnect,
  connect,
  moveNode,
  removeEdges,
  removeNode,
} from "../lib/graph";
import { defaultConfig, fallbackDescriptor, findDescriptor, summarize } from "../lib/nodeTypes";
import type { GraphNode, NodeHandle, NodeTypeDescriptor, WorkflowDefinition } from "../types/api";

/**
 * The node graph editor: draggable nodes, bezier edges, pan/zoom and selection.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BOUNDARY. This file is the ONLY place where the API's vocabulary and
 * React Flow's meet, and it must stay that way.
 *
 *   persisted / wire      React Flow (in memory only)
 *   ────────────────      ───────────────────────────
 *   node.nodeId      ←→   node.id
 *   edge.edgeId      ←→   edge.id
 *
 * The rename is not cosmetic: `sanitizeResponse` is global middleware that
 * recursively deletes every `id` key from every response body (the UUID-only
 * guarantee — it cannot tell a numeric primary key from a canvas node's name).
 * A definition keyed by `id` would come back with every node anonymous. So
 * `nodeId`/`edgeId` are what travel, React Flow's `id` never leaves this file,
 * and `lib/graph.ts` — which is what the rest of the app calls — knows only the
 * wire names.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * React Flow is the one new runtime dependency, and its stylesheet is imported
 * once in `main.tsx` (`dist/base.css` — the structural half, not the default
 * theme). Every selector it ships is scoped under `.react-flow`, so it cannot
 * leak into the rest of the module; the gold layer repaints it through the
 * library's own `--xy-*` custom properties.
 *
 * Nothing here is decided by a node type's NAME: the palette is the registry,
 * the handles a node draws are `descriptor.handles`, whether an edge may point
 * at it is `descriptor.acceptsInput`, and its summary line comes from its
 * config schema.
 */

interface Props {
  definition: WorkflowDefinition;
  descriptors: NodeTypeDescriptor[];
  /** Why the registry could not be read, when it could not. */
  registryError: string | null;
  /** The selected node's `nodeId`, in the API's vocabulary. */
  selectedId: string | null;
  onSelect: (nodeId: string | null) => void;
  onChange: (definition: WorkflowDefinition) => void;
  disabled: boolean;
}

/** Everything the card draws, precomputed from the descriptor. */
type CardData = {
  nodeType: string;
  label: string;
  summary: string;
  handles: NodeHandle[];
  acceptsInput: boolean;
};

type CardNode = Node<CardData, "nfNode">;

/** Where a new node lands: to the right of the rightmost one, on its row. */
function nextPosition(nodes: GraphNode[]): { x: number; y: number } {
  if (nodes.length === 0) return { x: 40, y: 90 };
  const rightmost = nodes.reduce((best, node) => (node.position.x > best.position.x ? node : best));
  return { x: rightmost.position.x + 240, y: rightmost.position.y };
}

/**
 * One card, for every node type there will ever be. The outgoing handles are
 * the ones the registry declares — two for the condition, one for everything
 * else today — spaced down the right edge, and the incoming handle exists only
 * when the type accepts input (nothing may point at the trigger).
 */
function NodeCard({ id, data }: NodeProps<CardNode>) {
  const count = data.handles.length;
  return (
    <div className={`nodecard nodecard--${data.nodeType}`} data-testid={`node-${id}`}>
      {data.acceptsInput ? (
        <Handle type="target" position={Position.Left} className="nodecard__handle" />
      ) : null}

      <span className="nodecard__type">{data.label}</span>
      <span className="nodecard__id tabular">{id}</span>
      {data.summary === "" ? (
        <span className="nodecard__summary nodecard__summary--empty">Sin configurar</span>
      ) : (
        <span className="nodecard__summary">{data.summary}</span>
      )}

      {data.handles.map((handle, index) => {
        // Evenly spaced down the right edge, computed rather than hardcoded, so
        // a type with a third branch needs no CSS and no component change.
        const top = count === 1 ? "50%" : `${((index + 1) * 100) / (count + 1)}%`;
        const label = HANDLE_LABELS[handle];
        return (
          <span key={handle}>
            <Handle
              type="source"
              id={handle}
              position={Position.Right}
              className="nodecard__handle"
              style={{ top }}
            />
            {label === undefined ? null : (
              <span className="nodecard__branch" style={{ top: `calc(${top} - 9px)` }}>
                {label}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

/** Stable identity: React Flow re-creates its node internals when this changes. */
const NODE_TYPES = { nfNode: NodeCard };

export function WorkflowCanvas({
  definition,
  descriptors,
  registryError,
  selectedId,
  onSelect,
  onChange,
  disabled,
}: Props) {
  /** React Flow's measured size per node — see `handleNodesChange`. */
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});

  // ---- wire → React Flow ---------------------------------------------------

  const nodes = useMemo<CardNode[]>(
    () =>
      definition.nodes.map((node) => {
        const descriptor = findDescriptor(descriptors, node.type) ?? fallbackDescriptor(node.type);
        return {
          id: node.nodeId,
          type: "nfNode" as const,
          position: node.position,
          measured: measured[node.nodeId],
          selected: node.nodeId === selectedId,
          draggable: !disabled,
          data: {
            nodeType: node.type,
            label: descriptor.label,
            summary: summarize(descriptor, node.config),
            handles: descriptor.handles,
            acceptsInput: descriptor.acceptsInput,
          },
        };
      }),
    [definition.nodes, descriptors, selectedId, disabled, measured],
  );

  const edges = useMemo<Edge[]>(
    () =>
      definition.edges.map((edge) => ({
        id: edge.edgeId,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        label: HANDLE_LABELS[edge.sourceHandle],
        markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
      })),
    [definition.edges],
  );

  // ---- React Flow → wire ---------------------------------------------------

  /**
   * Only the changes that mean something to a stored definition — position and
   * removal. Selection is not written back: the definition holds no `selected`
   * flag, so echoing one through it would fight the `selectedId` prop.
   *
   * Measured size is the third change and it belongs to neither. It cannot go
   * into the definition (a rendered pixel size is not part of a saved
   * workflow), but a controlled node with no `measured` is one React Flow
   * refuses to drag — "trying to drag a node that is not initialized". So it is
   * kept HERE, beside the canvas, and merged back in when the nodes are built.
   */
  const handleNodesChange = useCallback(
    (changes: NodeChange<CardNode>[]) => {
      let next = definition;
      for (const change of changes) {
        if (change.type === "dimensions" && change.dimensions !== undefined) {
          const { id, dimensions } = change;
          setMeasured((current) =>
            current[id]?.width === dimensions.width && current[id]?.height === dimensions.height
              ? current
              : { ...current, [id]: dimensions },
          );
        }
        // `change.id` is React Flow's id, which IS the node's `nodeId` — this
        // line and the two maps above are the whole translation.
        if (change.type === "position" && change.position !== undefined) {
          next = moveNode(next, change.id, change.position);
        }
        if (change.type === "remove") {
          next = removeNode(next, change.id);
          if (change.id === selectedId) onSelect(null);
        }
      }
      if (next !== definition) onChange(next);
    },
    [definition, onChange, onSelect, selectedId],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      const removed = new Set(
        changes.filter((change) => change.type === "remove").map((change) => change.id),
      );
      if (removed.size === 0) return;
      onChange(removeEdges(definition, removed));
    },
    [definition, onChange],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      const handle = (connection.sourceHandle ?? OUT_HANDLE) as NodeHandle;
      onChange(connect(definition, connection.source, handle, connection.target));
    },
    [definition, onChange],
  );

  /**
   * The refusals `connect` makes, told to the user while the wire is still in
   * the air: React Flow marks the target handle invalid and the gold layer
   * paints it. Refusing silently on drop is the version where people think the
   * canvas is broken.
   */
  const isValidConnection = useCallback(
    (connection: Connection | Edge) =>
      canConnect(
        definition,
        connection.source,
        (connection.sourceHandle ?? OUT_HANDLE) as NodeHandle,
        connection.target,
      ),
    [definition],
  );

  return (
    <div className="graph">
      <div className="graph__palette" data-testid="node-palette">
        <span className="graph__palette-label">Agregar</span>
        {descriptors.length === 0 ? (
          <span className="graph__palette-empty" data-testid="node-palette-empty">
            {registryError ?? "El servidor no publicó ningún tipo de nodo."}
          </span>
        ) : (
          descriptors.map((descriptor) => (
            <button
              key={descriptor.type}
              type="button"
              className="btn btn--quiet"
              data-testid={`add-node-${descriptor.type}`}
              title={descriptor.description === "" ? undefined : descriptor.description}
              disabled={disabled}
              onClick={() =>
                onChange(
                  addNode(
                    definition,
                    descriptor.type,
                    nextPosition(definition.nodes),
                    defaultConfig(descriptor),
                  ),
                )
              }
            >
              {descriptor.label}
            </button>
          ))
        )}
      </div>

      <div className="graph__canvas" data-testid="workflow-canvas">
        <ReactFlow<CardNode>
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          isValidConnection={isValidConnection}
          onNodeClick={(_event, node) => onSelect(node.id)}
          onPaneClick={() => onSelect(null)}
          nodesConnectable={!disabled}
          elementsSelectable
          fitView
          fitViewOptions={{ padding: 0.35, maxZoom: 1 }}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1.4} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
