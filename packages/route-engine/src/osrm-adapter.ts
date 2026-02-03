import type { Coordinate } from "@routeglyph/domain";
import type { FindPathRequest, PathResult, ShortestPathAdapter } from "./shortest-path.js";
import type { TraversableEdge } from "./graph.js";

type OsrmAdapterOptions = {
  baseUrl: string;
  profile?: "foot" | "walking" | "bike" | "driving";
  fallback?: ShortestPathAdapter;
};

function segmentDistanceMeters(a: Coordinate, b: Coordinate) {
  const dx = (a.lat - b.lat) * 111_000;
  const dy = (a.lon - b.lon) * 85_000;
  return Math.round(Math.sqrt(dx * dx + dy * dy));
}

function toCoordinate(raw: [number, number]): Coordinate {
  return { lat: raw[1], lon: raw[0] };
}

export class OsrmShortestPathAdapter implements ShortestPathAdapter {
  private readonly baseUrl: string;
  private readonly profile: "foot" | "walking" | "bike" | "driving";
  private readonly fallback?: ShortestPathAdapter;

  constructor(options: OsrmAdapterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.profile = options.profile ?? "foot";
    this.fallback = options.fallback;
  }

  async findPath(request: FindPathRequest): Promise<PathResult> {
    const start = request.graph.nodes.get(request.startNodeId);
    const end = request.graph.nodes.get(request.endNodeId);
    if (!start || !end) {
      throw new Error("Start or end node not found in graph.");
    }

    const url =
      `${this.baseUrl}/route/v1/${this.profile}/` +
      `${start.coordinate.lon},${start.coordinate.lat};` +
      `${end.coordinate.lon},${end.coordinate.lat}` +
      "?overview=full&geometries=geojson&steps=true";

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`OSRM returned ${response.status}`);
      }

      const data = (await response.json()) as {
        routes?: Array<{
          distance: number;
          duration: number;
          geometry?: { coordinates: [number, number][] };
        }>;
      };

      const bestRoute = data.routes?.[0];
      const coordinates = bestRoute?.geometry?.coordinates;
      if (!coordinates || coordinates.length < 2) {
        throw new Error("OSRM route has no geometry.");
      }

      const traversedEdges: TraversableEdge[] = [];
      for (let i = 0; i < coordinates.length - 1; i += 1) {
        const from = toCoordinate(coordinates[i]);
        const to = toCoordinate(coordinates[i + 1]);
        traversedEdges.push({
          edgeId: `osrm-${i}`,
          fromNodeId: i === 0 ? request.startNodeId : `osrm-node-${i}`,
          toNodeId: i === coordinates.length - 2 ? request.endNodeId : `osrm-node-${i + 1}`,
          lengthMeters: segmentDistanceMeters(from, to),
          streetName: "OSRM Path",
          hasSidewalk: true,
          litAtNight: true,
          trafficStress: 2,
          elevationGainMeters: 0,
          fromCoordinate: from,
          toCoordinate: to
        });
      }

      const totalDistanceMeters = Math.round(bestRoute.distance ?? 0);
      return {
        nodeIds: [request.startNodeId, request.endNodeId],
        traversedEdges,
        totalDistanceMeters,
        totalCost: totalDistanceMeters
      };
    } catch (error) {
      if (this.fallback) {
        return this.fallback.findPath(request);
      }
      throw error;
    }
  }
}
