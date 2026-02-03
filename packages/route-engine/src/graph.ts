import type { Coordinate } from "@routeglyph/domain";

export type RoadNode = {
  id: string;
  coordinate: Coordinate;
  elevationMeters?: number;
};

export type RoadEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  streetName: string;
  lengthMeters: number;
  bidirectional: boolean;
  hasSidewalk: boolean;
  litAtNight: boolean;
  trafficStress: 1 | 2 | 3 | 4 | 5;
  elevationGainMeters: number;
};

export type TraversableEdge = {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  lengthMeters: number;
  streetName: string;
  hasSidewalk: boolean;
  litAtNight: boolean;
  trafficStress: 1 | 2 | 3 | 4 | 5;
  elevationGainMeters: number;
  fromCoordinate?: Coordinate;
  toCoordinate?: Coordinate;
};

export type RoadGraph = {
  nodes: Map<string, RoadNode>;
  edges: Map<string, RoadEdge>;
  traversableFrom: Map<string, TraversableEdge[]>;
};

export type StreetCandidate = {
  id: string;
  name: string;
  coordinate: Coordinate;
};

function distanceMeters(a: Coordinate, b: Coordinate) {
  const dx = (a.lat - b.lat) * 111_000;
  const dy = (a.lon - b.lon) * 85_000;
  return Math.round(Math.sqrt(dx * dx + dy * dy));
}

export function createRoadGraph(nodes: RoadNode[], edges: RoadEdge[]): RoadGraph {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const edgeMap = new Map(edges.map((edge) => [edge.id, edge]));
  const traversableFrom = new Map<string, TraversableEdge[]>();

  for (const edge of edges) {
    const forward: TraversableEdge = {
      edgeId: edge.id,
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
      lengthMeters: edge.lengthMeters,
      streetName: edge.streetName,
      hasSidewalk: edge.hasSidewalk,
      litAtNight: edge.litAtNight,
      trafficStress: edge.trafficStress,
      elevationGainMeters: edge.elevationGainMeters
    };
    const existing = traversableFrom.get(forward.fromNodeId) ?? [];
    existing.push(forward);
    traversableFrom.set(forward.fromNodeId, existing);

    if (edge.bidirectional) {
      const reverse: TraversableEdge = {
        ...forward,
        fromNodeId: edge.toNodeId,
        toNodeId: edge.fromNodeId,
        elevationGainMeters: -edge.elevationGainMeters
      };
      const reverseExisting = traversableFrom.get(reverse.fromNodeId) ?? [];
      reverseExisting.push(reverse);
      traversableFrom.set(reverse.fromNodeId, reverseExisting);
    }
  }

  return {
    nodes: nodeMap,
    edges: edgeMap,
    traversableFrom
  };
}

export function findNearestNodeId(graph: RoadGraph, coordinate: Coordinate): string {
  let bestNodeId = "";
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const node of graph.nodes.values()) {
    const distance = distanceMeters(node.coordinate, coordinate);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestNodeId = node.id;
    }
  }

  if (!bestNodeId) {
    throw new Error("Graph has no nodes.");
  }
  return bestNodeId;
}

export function createSeedRoadGraph(
  center: Coordinate,
  options?: { radiusMeters?: number }
): RoadGraph {
  const spacingLat = 0.00135;
  const spacingLon = 0.00175;
  const minimumSize = 7;
  const requestedSize = options?.radiusMeters
    ? Math.ceil(options.radiusMeters / 175) * 2 + 1
    : minimumSize;
  const size = Math.min(27, Math.max(minimumSize, requestedSize));
  const half = Math.floor(size / 2);

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const rows = Array.from({ length: size }, (_, i) => {
    const letter = alphabet[i % alphabet.length];
    const cycle = Math.floor(i / alphabet.length);
    return `${letter}${cycle > 0 ? cycle + 1 : ""} Ave`;
  });
  const cols = Array.from({ length: size }, (_, i) => {
    const letter = alphabet[i % alphabet.length];
    const cycle = Math.floor(i / alphabet.length);
    return `${letter}${cycle > 0 ? cycle + 1 : ""} St`;
  });

  const nodes: RoadNode[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      nodes.push({
        id: `n-${y}-${x}`,
        coordinate: {
          lat: center.lat + (y - half) * spacingLat,
          lon: center.lon + (x - half) * spacingLon
        },
        elevationMeters: 10 + y * 3 + x
      });
    }
  }

  const edges: RoadEdge[] = [];
  let edgeCount = 0;
  const getNode = (y: number, x: number) => nodes[y * size + x];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const a = getNode(y, x);
      const b = getNode(y, x + 1);
      edges.push({
        id: `e-${edgeCount++}`,
        fromNodeId: a.id,
        toNodeId: b.id,
        streetName: rows[y],
        lengthMeters: distanceMeters(a.coordinate, b.coordinate),
        bidirectional: true,
        hasSidewalk: true,
        litAtNight: y % 4 !== 0,
        trafficStress: ((y % 5) + 1) as 1 | 2 | 3 | 4 | 5,
        elevationGainMeters: (b.elevationMeters ?? 0) - (a.elevationMeters ?? 0)
      });
    }
  }

  for (let x = 0; x < size; x += 1) {
    for (let y = 0; y < size - 1; y += 1) {
      const a = getNode(y, x);
      const b = getNode(y + 1, x);
      edges.push({
        id: `e-${edgeCount++}`,
        fromNodeId: a.id,
        toNodeId: b.id,
        streetName: cols[x],
        lengthMeters: distanceMeters(a.coordinate, b.coordinate),
        bidirectional: true,
        hasSidewalk: x % 6 !== 0,
        litAtNight: y % 3 !== 0,
        trafficStress: ((x % 5) + 1) as 1 | 2 | 3 | 4 | 5,
        elevationGainMeters: (b.elevationMeters ?? 0) - (a.elevationMeters ?? 0)
      });
    }
  }

  return createRoadGraph(nodes, edges);
}

export function createStreetAreaGraph(start: Coordinate, streets: StreetCandidate[]): RoadGraph {
  const nodes: RoadNode[] = [
    {
      id: "start",
      coordinate: start
    },
    ...streets.map((street) => ({
      id: street.id,
      coordinate: street.coordinate
    }))
  ];

  const edges: RoadEdge[] = [];
  let edgeCount = 0;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const kNeighbors = 5;

  for (const fromNode of nodes) {
    const nearest = nodes
      .filter((node) => node.id !== fromNode.id)
      .map((node) => ({
        node,
        distance: distanceMeters(fromNode.coordinate, node.coordinate)
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, kNeighbors);

    for (const { node: toNode, distance } of nearest) {
      const toStreet = streets.find((street) => street.id === toNode.id);
      const fromStreet = streets.find((street) => street.id === fromNode.id);
      edges.push({
        id: `s-${edgeCount++}`,
        fromNodeId: fromNode.id,
        toNodeId: toNode.id,
        streetName: toStreet?.name ?? fromStreet?.name ?? "Connector",
        lengthMeters: distance,
        bidirectional: true,
        hasSidewalk: true,
        litAtNight: true,
        trafficStress: 2,
        elevationGainMeters:
          (nodeById.get(toNode.id)?.elevationMeters ?? 0) -
          (nodeById.get(fromNode.id)?.elevationMeters ?? 0)
      });
    }
  }

  return createRoadGraph(nodes, edges);
}
