import type { Coordinate, CoverageRouteRequest } from "@routeglyph/domain";
import type { StreetCandidate } from "./graph.js";

export interface StreetCatalogProvider {
  fetchStreetCandidates(request: CoverageRouteRequest): Promise<StreetCandidate[]>;
}

type OverpassStreetCatalogOptions = {
  endpointUrl?: string;
  timeoutMs?: number;
};

function buildOverpassQuery(center: Coordinate, radiusMeters: number) {
  return `
[out:json][timeout:25];
(
  way(around:${Math.round(radiusMeters)},${center.lat},${center.lon})["highway"]["name"];
);
out center tags;
`;
}

export class OverpassStreetCatalogProvider implements StreetCatalogProvider {
  private readonly endpointUrl: string;
  private readonly timeoutMs: number;

  constructor(options: OverpassStreetCatalogOptions = {}) {
    this.endpointUrl = options.endpointUrl ?? "https://overpass-api.de/api/interpreter";
    this.timeoutMs = options.timeoutMs ?? 8000;
  }

  async fetchStreetCandidates(request: CoverageRouteRequest): Promise<StreetCandidate[]> {
    const center = request.area?.center ?? request.start;
    const radiusMeters = request.area?.radiusMeters ?? 3000;
    const query = buildOverpassQuery(center, radiusMeters);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let payload: {
      elements?: Array<{
        id: number;
        tags?: { name?: string };
        center?: { lat: number; lon: number };
      }>;
    };
    try {
      const response = await fetch(this.endpointUrl, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain"
        },
        body: query,
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`Overpass returned ${response.status}`);
      }

      payload = (await response.json()) as {
        elements?: Array<{
          id: number;
          tags?: { name?: string };
          center?: { lat: number; lon: number };
        }>;
      };
    } finally {
      clearTimeout(timeout);
    }

    const seen = new Set<string>();
    const streets: StreetCandidate[] = [];
    for (const element of payload.elements ?? []) {
      const name = element.tags?.name?.trim();
      const centerPoint = element.center;
      if (!name || !centerPoint) {
        continue;
      }

      const dedupeKey = `${name.toLowerCase()}-${centerPoint.lat.toFixed(5)}-${centerPoint.lon.toFixed(5)}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);

      streets.push({
        id: `osm-way-${element.id}`,
        name,
        coordinate: {
          lat: centerPoint.lat,
          lon: centerPoint.lon
        }
      });
      if (streets.length >= 250) {
        break;
      }
    }
    return streets;
  }
}
