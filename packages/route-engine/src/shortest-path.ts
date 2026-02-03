import type { RoadGraph, TraversableEdge } from "./graph.js";
import {
  DEFAULT_ROUTE_OBJECTIVE_WEIGHTS,
  scoreEdgeTraversal,
  scoreTurn,
  type RouteObjectiveWeights
} from "./scoring.js";

export type PathResult = {
  nodeIds: string[];
  traversedEdges: TraversableEdge[];
  totalDistanceMeters: number;
  totalCost: number;
};

export type FindPathRequest = {
  graph: RoadGraph;
  startNodeId: string;
  endNodeId: string;
  weights?: RouteObjectiveWeights;
};

export interface ShortestPathAdapter {
  findPath(request: FindPathRequest): Promise<PathResult>;
}

type PathState = {
  key: string;
  nodeId: string;
  previousNodeId?: string;
  cost: number;
  distanceMeters: number;
  parentKey?: string;
  viaEdge?: TraversableEdge;
};

function createKey(nodeId: string, previousNodeId?: string) {
  return `${nodeId}|${previousNodeId ?? "start"}`;
}

function reconstructPath(stateMap: Map<string, PathState>, finalKey: string): PathResult {
  const reversed: PathState[] = [];
  let currentKey: string | undefined = finalKey;
  while (currentKey) {
    const state = stateMap.get(currentKey);
    if (!state) break;
    reversed.push(state);
    currentKey = state.parentKey;
  }

  const states = reversed.reverse();
  const nodeIds = states.map((state) => state.nodeId);
  const traversedEdges = states
    .map((state) => state.viaEdge)
    .filter((edge): edge is TraversableEdge => edge !== undefined);

  const finalState = states[states.length - 1];
  return {
    nodeIds,
    traversedEdges,
    totalDistanceMeters: finalState?.distanceMeters ?? 0,
    totalCost: finalState?.cost ?? 0
  };
}

export class InMemoryShortestPathAdapter implements ShortestPathAdapter {
  async findPath(request: FindPathRequest): Promise<PathResult> {
    const { graph, startNodeId, endNodeId } = request;
    const weights = request.weights ?? DEFAULT_ROUTE_OBJECTIVE_WEIGHTS;
    const open: PathState[] = [
      {
        key: createKey(startNodeId),
        nodeId: startNodeId,
        cost: 0,
        distanceMeters: 0
      }
    ];
    const bestCostByState = new Map<string, number>();
    const stateMap = new Map<string, PathState>();

    bestCostByState.set(open[0].key, 0);
    stateMap.set(open[0].key, open[0]);

    while (open.length > 0) {
      open.sort((a, b) => a.cost - b.cost);
      const current = open.shift();
      if (!current) break;

      if (current.nodeId === endNodeId) {
        return reconstructPath(stateMap, current.key);
      }

      const outgoing = graph.traversableFrom.get(current.nodeId) ?? [];
      for (const edge of outgoing) {
        const nextNodeId = edge.toNodeId;
        const nextKey = createKey(nextNodeId, current.nodeId);
        let nextCost = current.cost + scoreEdgeTraversal(edge, weights);

        if (current.previousNodeId) {
          const previous = graph.nodes.get(current.previousNodeId);
          const at = graph.nodes.get(current.nodeId);
          const next = graph.nodes.get(nextNodeId);
          if (previous && at && next) {
            nextCost += scoreTurn(previous.coordinate, at.coordinate, next.coordinate, weights);
          }
        }

        const knownBest = bestCostByState.get(nextKey);
        if (knownBest !== undefined && knownBest <= nextCost) {
          continue;
        }

        const nextState: PathState = {
          key: nextKey,
          nodeId: nextNodeId,
          previousNodeId: current.nodeId,
          cost: nextCost,
          distanceMeters: current.distanceMeters + edge.lengthMeters,
          parentKey: current.key,
          viaEdge: edge
        };
        bestCostByState.set(nextKey, nextCost);
        stateMap.set(nextKey, nextState);
        open.push(nextState);
      }
    }

    throw new Error(`No path found between nodes '${startNodeId}' and '${endNodeId}'.`);
  }
}
