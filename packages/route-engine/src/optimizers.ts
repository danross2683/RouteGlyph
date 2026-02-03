import type {
  Coordinate,
  CoverageRouteRequest,
  GeneratedRoute,
  RouteSegment,
  ShapeRouteRequest
} from "@routeglyph/domain";
import {
  createStreetAreaGraph,
  createSeedRoadGraph,
  findNearestNodeId,
  type RoadGraph,
  type TraversableEdge
} from "./graph.js";
import { InMemoryShortestPathAdapter, type ShortestPathAdapter } from "./shortest-path.js";
import type { StreetCatalogProvider } from "./street-catalog.js";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function dedupeConsecutive<T>(items: T[]) {
  return items.filter((item, index) => index === 0 || item !== items[index - 1]);
}

function resolveCoordinate(
  graph: RoadGraph,
  nodeId: string,
  fallback?: Coordinate
): Coordinate | undefined {
  return graph.nodes.get(nodeId)?.coordinate ?? fallback;
}

function traversalsToSegments(graph: RoadGraph, traversals: TraversableEdge[]): RouteSegment[] {
  const segments: RouteSegment[] = [];
  for (const edge of traversals) {
    const from = resolveCoordinate(graph, edge.fromNodeId, edge.fromCoordinate);
    const to = resolveCoordinate(graph, edge.toNodeId, edge.toCoordinate);
    if (!from || !to) {
      continue;
    }
    segments.push({
      from,
      to,
      streetName: edge.streetName
    });
  }
  return segments;
}

function appendPath(target: TraversableEdge[], incoming: TraversableEdge[]) {
  for (const edge of incoming) {
    target.push(edge);
  }
}

function distanceOf(edges: TraversableEdge[]) {
  return edges.reduce((sum, edge) => sum + edge.lengthMeters, 0);
}

function approximateDistanceMeters(a: Coordinate, b: Coordinate) {
  const dx = (a.lat - b.lat) * 111_000;
  const dy = (a.lon - b.lon) * 85_000;
  return Math.round(Math.sqrt(dx * dx + dy * dy));
}

function approximateNodeDistanceMeters(graph: RoadGraph, fromId: string, toId: string) {
  const from = graph.nodes.get(fromId)?.coordinate;
  const to = graph.nodes.get(toId)?.coordinate;
  if (!from || !to) {
    return 0;
  }
  return approximateDistanceMeters(from, to);
}

function firstLetter(name: string) {
  const match = name.toUpperCase().match(/[A-Z]/);
  return match?.[0];
}

function normalizeAlphabet(input?: string[]) {
  const requested = input?.length ? input : ALPHABET;
  return [...new Set(requested.map((item) => firstLetter(item)).filter((v): v is string => !!v))];
}

function chooseCoverageStrategy(request: CoverageRouteRequest) {
  if (request.strategy) {
    return request.strategy;
  }
  return request.targetStreets.length > 0 ? "target_streets" : "alphabet";
}

function matchesTargetStreet(edge: TraversableEdge, targets: string[]) {
  if (targets.length === 0) {
    return true;
  }
  const edgeName = edge.streetName.toLowerCase();
  return targets.some((target) => edgeName.includes(target.toLowerCase()));
}

function uniqueEdges(graph: RoadGraph) {
  const seen = new Set<string>();
  const edges: TraversableEdge[] = [];
  for (const outgoing of graph.traversableFrom.values()) {
    for (const edge of outgoing) {
      const key = `${edge.fromNodeId}->${edge.toNodeId}->${edge.edgeId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      edges.push(edge);
    }
  }
  return edges;
}

function shortlistCandidates(params: {
  currentNodeId: string;
  startNodeId: string;
  graph: RoadGraph;
  candidates: TraversableEdge[];
  strategy: "target_streets" | "alphabet";
  letterFrequency: Map<string, number>;
  usedStreetNames: Map<string, number>;
}) {
  const {
    candidates,
    currentNodeId,
    graph,
    startNodeId,
    strategy,
    letterFrequency,
    usedStreetNames
  } = params;
  return candidates
    .map((edge) => ({
      edge,
      score:
        approximateNodeDistanceMeters(graph, currentNodeId, edge.fromNodeId) +
        edge.lengthMeters +
        approximateNodeDistanceMeters(graph, edge.toNodeId, startNodeId) -
        (strategy === "alphabet"
          ? 400 / Math.max(1, letterFrequency.get(firstLetter(edge.streetName) ?? "") ?? 1)
          : 0) +
        (usedStreetNames.get(edge.streetName.toLowerCase()) ?? 0) * 120
    }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 20)
    .map((item) => item.edge);
}

function withinDistanceBudget(params: {
  graph: RoadGraph;
  currentDistanceMeters: number;
  edge: TraversableEdge;
  currentNodeId: string;
  startNodeId: string;
  maxDistanceMeters?: number;
}) {
  const { currentDistanceMeters, currentNodeId, edge, graph, maxDistanceMeters, startNodeId } =
    params;
  if (!maxDistanceMeters) {
    return true;
  }
  const projected =
    currentDistanceMeters +
    approximateNodeDistanceMeters(graph, currentNodeId, edge.fromNodeId) +
    edge.lengthMeters +
    approximateNodeDistanceMeters(graph, edge.toNodeId, startNodeId);
  return projected <= maxDistanceMeters;
}

function calculateCoverageQualityMetrics(edges: TraversableEdge[]) {
  let estimatedElevationGainMeters = 0;
  const streetCounts = new Map<string, number>();

  for (const edge of edges) {
    estimatedElevationGainMeters += Math.max(0, edge.elevationGainMeters);
    const key = edge.streetName.toLowerCase();
    streetCounts.set(key, (streetCounts.get(key) ?? 0) + 1);
  }

  const duplicateTraversals = [...streetCounts.values()].reduce(
    (sum, count) => sum + Math.max(0, count - 1),
    0
  );

  return {
    estimatedElevationGainMeters: Math.round(estimatedElevationGainMeters),
    duplicateStreetPenalty: duplicateTraversals,
    uniqueStreetCount: streetCounts.size
  };
}

export async function optimizeCoverageRoute(
  request: CoverageRouteRequest,
  dependencies?: {
    graph?: RoadGraph;
    shortestPath?: ShortestPathAdapter;
    streetCatalog?: StreetCatalogProvider;
  }
): Promise<GeneratedRoute> {
  const strategy = chooseCoverageStrategy(request);
  const center = request.area?.center ?? request.start;
  let graph =
    dependencies?.graph ??
    createSeedRoadGraph(center, { radiusMeters: request.area?.radiusMeters });
  const shortestPath = dependencies?.shortestPath ?? new InMemoryShortestPathAdapter();

  if (dependencies?.streetCatalog) {
    try {
      const streets = await dependencies.streetCatalog.fetchStreetCandidates(request);
      if (streets.length > 2) {
        graph = createStreetAreaGraph(request.start, streets);
      }
    } catch {
      // Fallback to seeded graph when live OSM lookup is unavailable.
    }
  }
  const startNodeId = findNearestNodeId(graph, request.start);

  const allEdges = uniqueEdges(graph);
  const targetLetters = normalizeAlphabet(request.alphabet);
  const targetStreetNames = request.targetStreets;
  const maxDistanceMeters = request.maxDistanceMeters;
  const letterFrequency = new Map<string, number>();
  for (const edge of allEdges) {
    const letter = firstLetter(edge.streetName);
    if (!letter) {
      continue;
    }
    letterFrequency.set(letter, (letterFrequency.get(letter) ?? 0) + 1);
  }

  let currentNodeId = startNodeId;
  let currentDistanceMeters = 0;
  const traversed: TraversableEdge[] = [];
  const coveredLetters = new Set<string>();
  let matchedStreetCount = 0;
  const usedStreetNames = new Map<string, number>();

  const remaining = new Set<string>(targetLetters);
  const alphabetSelectionCap = Math.max(
    6,
    Math.min(14, Math.floor((maxDistanceMeters ?? 8_000) / 800))
  );
  const maxSelections =
    strategy === "alphabet"
      ? Math.max(1, Math.min(targetLetters.length, alphabetSelectionCap))
      : Math.max(3, targetStreetNames.length || 3);

  for (let i = 0; i < maxSelections; i += 1) {
    const candidates = allEdges.filter((edge) => {
      if (strategy === "alphabet") {
        const letter = firstLetter(edge.streetName);
        return !!letter && remaining.has(letter);
      }
      return matchesTargetStreet(edge, targetStreetNames);
    });
    if (candidates.length === 0) {
      break;
    }

    const shortlisted = shortlistCandidates({
      candidates,
      currentNodeId,
      graph,
      startNodeId,
      strategy,
      letterFrequency,
      usedStreetNames
    });
    const selectedEdge = shortlisted.find((candidate) =>
      withinDistanceBudget({
        currentDistanceMeters,
        currentNodeId,
        edge: candidate,
        graph,
        maxDistanceMeters,
        startNodeId
      })
    );

    if (!selectedEdge) {
      break;
    }

    const toStart = await shortestPath.findPath({
      graph,
      startNodeId: currentNodeId,
      endNodeId: selectedEdge.fromNodeId
    });
    const projectedDistance =
      currentDistanceMeters + toStart.totalDistanceMeters + selectedEdge.lengthMeters;
    if (maxDistanceMeters && projectedDistance > maxDistanceMeters) {
      break;
    }

    appendPath(traversed, toStart.traversedEdges);
    currentDistanceMeters = distanceOf(traversed);
    // Touch coverage mode: reaching the street anchor is enough.
    currentNodeId = selectedEdge.fromNodeId;
    const streetKey = selectedEdge.streetName.toLowerCase();
    usedStreetNames.set(streetKey, (usedStreetNames.get(streetKey) ?? 0) + 1);

    const letter = firstLetter(selectedEdge.streetName);
    if (letter) {
      coveredLetters.add(letter);
      remaining.delete(letter);
    }
    if (matchesTargetStreet(selectedEdge, targetStreetNames)) {
      matchedStreetCount += 1;
    }
  }

  const returnPath = await shortestPath.findPath({
    graph,
    startNodeId: currentNodeId,
    endNodeId: startNodeId
  });
  if (
    !maxDistanceMeters ||
    currentDistanceMeters + returnPath.totalDistanceMeters <= maxDistanceMeters
  ) {
    appendPath(traversed, returnPath.traversedEdges);
  }

  const distanceMeters = distanceOf(traversed);
  const quality = calculateCoverageQualityMetrics(traversed);
  return {
    id: `route-${Date.now()}`,
    mode: "coverage",
    name: request.name,
    createdAtIso: new Date().toISOString(),
    distanceMeters,
    segments: traversalsToSegments(graph, traversed),
    coverage: {
      strategy,
      lettersCovered: [...coveredLetters].sort(),
      lettersRequested: strategy === "alphabet" ? targetLetters : [],
      matchedStreetCount,
      maxDistanceMeters,
      estimatedElevationGainMeters: quality.estimatedElevationGainMeters,
      duplicateStreetPenalty: quality.duplicateStreetPenalty,
      uniqueStreetCount: quality.uniqueStreetCount
    }
  };
}

export async function optimizeShapeRoute(
  request: ShapeRouteRequest,
  dependencies?: { graph?: RoadGraph; shortestPath?: ShortestPathAdapter }
): Promise<GeneratedRoute> {
  const fallback: Coordinate = { lat: 0, lon: 0 };
  const points = request.points.length >= 2 ? request.points : [request.points[0] ?? fallback];
  const graph = dependencies?.graph ?? createSeedRoadGraph(points[0] ?? fallback);
  const shortestPath = dependencies?.shortestPath ?? new InMemoryShortestPathAdapter();

  const snappedNodes = dedupeConsecutive(points.map((point) => findNearestNodeId(graph, point)));

  const traversed: TraversableEdge[] = [];
  for (let i = 0; i < snappedNodes.length - 1; i += 1) {
    const segmentPath = await shortestPath.findPath({
      graph,
      startNodeId: snappedNodes[i],
      endNodeId: snappedNodes[i + 1]
    });
    appendPath(traversed, segmentPath.traversedEdges);
  }

  const distanceMeters = distanceOf(traversed);
  return {
    id: `route-${Date.now()}`,
    mode: "shape",
    name: request.name,
    createdAtIso: new Date().toISOString(),
    distanceMeters,
    segments: traversalsToSegments(graph, traversed)
  };
}
