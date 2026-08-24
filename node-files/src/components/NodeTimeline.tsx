import { formatDateTime, formatDuration, nodeRunStatusLabel } from "../lib/format";
import type { NodeRun } from "../types/api";

interface Props {
  nodeRuns: NodeRun[];
}

/**
 * What the graph actually did, one row per node.
 *
 * The status chip is the module's existing `.state` / `.state--*` component,
 * used verbatim. There is no second status vocabulary for the same states:
 * `succeeded` and `failed` already mean here exactly what they mean on a run,
 * and inventing a parallel palette is how two palettes drift apart.
 *
 * A row exists only for a node whose turn is over — the API writes it once, at
 * the end — so there is nothing to poll and no half-finished row to render.
 */
export function NodeTimeline({ nodeRuns }: Props) {
  return (
    <>
      <h2 className="section-title">Nodos</h2>
      <ol className="rows rows--spaced timeline" data-testid="node-timeline">
        {nodeRuns.map((nodeRun) => (
          <li className="row row--plain timeline__row" key={nodeRun.uuid}>
            <span className="row__main">
              <span className="row__name">
                {nodeRun.nodeId}
                <span className="row__tag">{nodeRun.nodeType}</span>
              </span>
              <span className="row__meta">
                {formatDateTime(nodeRun.createdAt)}
                {nodeRun.attempt > 1 ? ` · intento ${nodeRun.attempt}` : ""}
                {nodeRun.error ? ` · ${nodeRun.error}` : ""}
              </span>
            </span>
            <span
              className={`state state--${nodeRun.status}`}
              data-testid={`node-run-status-${nodeRun.nodeId}`}
            >
              {nodeRunStatusLabel(nodeRun.status)}
            </span>
            <span className="row__when tabular" data-testid={`node-run-duration-${nodeRun.nodeId}`}>
              {formatDuration(nodeRun.durationMs)}
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}
