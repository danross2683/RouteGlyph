import type { Coordinate } from "@routeglyph/domain";
import type { TraversableEdge } from "./graph.js";

export type RouteObjectiveWeights = {
  distance: number;
  elevation: number;
  turns: number;
  safety: number;
  uTurn: number;
};

export const DEFAULT_ROUTE_OBJECTIVE_WEIGHTS: RouteObjectiveWeights = {
  distance: 1.0,
  elevation: 0.25,
  turns: 0.4,
  safety: 0.9,
  uTurn: 1.2
};

export function scoreEdgeTraversal(
  edge: TraversableEdge,
  weights: RouteObjectiveWeights = DEFAULT_ROUTE_OBJECTIVE_WEIGHTS
) {
  const safetyPenalty =
    (edge.trafficStress - 1) * 0.35 + (edge.hasSidewalk ? 0 : 0.7) + (edge.litAtNight ? 0 : 0.2);

  const uphillMeters = Math.max(0, edge.elevationGainMeters);
  return (
    edge.lengthMeters * weights.distance +
    uphillMeters * weights.elevation +
    safetyPenalty * 100 * weights.safety
  );
}

function angleBetweenDegrees(a: Coordinate, b: Coordinate, c: Coordinate) {
  const v1x = a.lon - b.lon;
  const v1y = a.lat - b.lat;
  const v2x = c.lon - b.lon;
  const v2y = c.lat - b.lat;

  const dot = v1x * v2x + v1y * v2y;
  const mag1 = Math.sqrt(v1x * v1x + v1y * v1y);
  const mag2 = Math.sqrt(v2x * v2x + v2y * v2y);
  if (mag1 === 0 || mag2 === 0) {
    return 0;
  }

  const cosine = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
  return (Math.acos(cosine) * 180) / Math.PI;
}

export function scoreTurn(
  previousCoordinate: Coordinate,
  currentCoordinate: Coordinate,
  nextCoordinate: Coordinate,
  weights: RouteObjectiveWeights = DEFAULT_ROUTE_OBJECTIVE_WEIGHTS
) {
  const angle = angleBetweenDegrees(previousCoordinate, currentCoordinate, nextCoordinate);
  const bendPenalty = (angle / 180) * 100 * weights.turns;
  const isUTurn = angle > 165;
  return bendPenalty + (isUTurn ? 100 * weights.uTurn : 0);
}
