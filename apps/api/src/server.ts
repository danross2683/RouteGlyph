import cors from "@fastify/cors";
import Fastify from "fastify";
import type {
  Coordinate,
  CoverageRouteRequest,
  GeneratedRoute,
  ShapeRouteRequest
} from "@routeglyph/domain";
import { toGpx } from "@routeglyph/gpx";
import {
  createShortestPathAdapter,
  generateCoverageRoute,
  InMemoryShortestPathAdapter,
  OverpassStreetCatalogProvider,
  type RoutingProvider,
  generateShapeRoute
} from "@routeglyph/route-engine";

const fallbackStart: Coordinate = { lat: 40.741, lon: -73.989 };

function routePoints(route: GeneratedRoute): Coordinate[] {
  if (!route.segments.length) {
    return [];
  }
  const first = route.segments[0]?.from;
  const rest = route.segments.map((segment) => segment.to);
  return first ? [first, ...rest] : rest;
}

function dedupeConsecutivePoints(points: Coordinate[]): Coordinate[] {
  const unique: Coordinate[] = [];
  for (const point of points) {
    const previous = unique[unique.length - 1];
    if (!previous || previous.lat !== point.lat || previous.lon !== point.lon) {
      unique.push(point);
    }
  }
  return unique;
}

function downsampleWaypoints(points: Coordinate[], maxWaypoints: number): Coordinate[] {
  if (points.length <= maxWaypoints) {
    return points;
  }
  const step = Math.ceil(points.length / maxWaypoints);
  const sampled = points.filter((_, index) => index % step === 0);
  const last = points[points.length - 1];
  if (sampled[sampled.length - 1] !== last) {
    sampled.push(last);
  }
  return sampled;
}

type OsrmStep = {
  name?: string;
  geometry?: { coordinates?: [number, number][] };
};

function segmentsFromOsrmSteps(steps: OsrmStep[]): GeneratedRoute["segments"] {
  const segments: GeneratedRoute["segments"] = [];
  for (const step of steps) {
    const coordinates = step.geometry?.coordinates ?? [];
    for (let i = 0; i < coordinates.length - 1; i += 1) {
      segments.push({
        from: { lat: coordinates[i][1], lon: coordinates[i][0] },
        to: { lat: coordinates[i + 1][1], lon: coordinates[i + 1][0] },
        streetName: step.name?.trim() || "Unnamed Road"
      });
    }
  }
  return segments;
}

function segmentsFromGeometry(
  coordinates: [number, number][],
  streetName = "OSRM Path"
): GeneratedRoute["segments"] {
  return coordinates.slice(0, -1).map((coordinate, index) => ({
    from: { lat: coordinate[1], lon: coordinate[0] },
    to: { lat: coordinates[index + 1][1], lon: coordinates[index + 1][0] },
    streetName
  }));
}

function withCoverageSnapMeta(
  route: GeneratedRoute,
  snappedToRoads: boolean,
  snapReason?: string
): GeneratedRoute {
  if (!route.coverage) {
    return route;
  }
  return {
    ...route,
    coverage: {
      ...route.coverage,
      snappedToRoads,
      snapReason
    }
  };
}

function deriveCoverageFromFinalRoute(route: GeneratedRoute): GeneratedRoute {
  if (!route.coverage) {
    return route;
  }

  const ignoredStreetNames = new Set(["osrm path", "unnamed road"]);
  const streetCounts = new Map<string, number>();
  const letterSet = new Set<string>();

  for (const segment of route.segments) {
    const streetName = segment.streetName?.trim();
    if (!streetName) {
      continue;
    }
    if (ignoredStreetNames.has(streetName.toLowerCase())) {
      continue;
    }
    const streetKey = streetName.toLowerCase();
    streetCounts.set(streetKey, (streetCounts.get(streetKey) ?? 0) + 1);

    const letter = streetName.toUpperCase().match(/[A-Z]/)?.[0];
    if (letter) {
      letterSet.add(letter);
    }
  }

  const duplicateStreetPenalty = [...streetCounts.values()].reduce(
    (sum, count) => sum + Math.max(0, count - 1),
    0
  );

  return {
    ...route,
    coverage: {
      ...route.coverage,
      plannedLettersCovered: route.coverage.lettersCovered,
      lettersCovered: [...letterSet].sort(),
      uniqueStreetCount: streetCounts.size,
      duplicateStreetPenalty
    }
  };
}

async function snapCoverageRouteToRoads(
  route: GeneratedRoute,
  osrmBaseUrl: string
): Promise<GeneratedRoute> {
  const points = dedupeConsecutivePoints(routePoints(route));
  if (points.length < 2) {
    return route;
  }

  const base = osrmBaseUrl.replace(/\/$/, "");
  const routeBetween = async (from: Coordinate, to: Coordinate) => {
    const url =
      `${base}/route/v1/foot/${from.lon},${from.lat};${to.lon},${to.lat}` +
      "?overview=full&geometries=geojson&steps=true";
    const response = await fetch(url);
    if (!response.ok) {
      return undefined;
    }
    const payload = (await response.json()) as {
      routes?: Array<{
        distance?: number;
        legs?: Array<{ steps?: OsrmStep[] }>;
        geometry?: { coordinates?: [number, number][] };
      }>;
    };
    return payload.routes?.[0];
  };

  // Prefer map-matching, which snaps an existing polyline to nearby roads.
  const matchPoints = downsampleWaypoints(points, 40);
  const matchCoordinates = matchPoints.map((point) => `${point.lon},${point.lat}`).join(";");
  const matchUrl =
    `${base}/match/v1/foot/${matchCoordinates}` +
    "?overview=full&geometries=geojson&steps=true&gaps=ignore&tidy=true";

  let coordinates: [number, number][] | undefined;
  let distanceMeters: number | undefined;
  let snappedSegments: GeneratedRoute["segments"] | undefined;
  const matchResponse = await fetch(matchUrl);
  if (matchResponse.ok) {
    const matchPayload = (await matchResponse.json()) as {
      matchings?: Array<{
        distance?: number;
        legs?: Array<{ steps?: OsrmStep[] }>;
        geometry?: { coordinates?: [number, number][] };
      }>;
    };
    const bestMatch = matchPayload.matchings?.[0];
    coordinates = bestMatch?.geometry?.coordinates;
    distanceMeters = bestMatch?.distance;
    const matchSteps = bestMatch?.legs?.flatMap((leg) => leg.steps ?? []) ?? [];
    if (matchSteps.length) {
      snappedSegments = segmentsFromOsrmSteps(matchSteps);
    }
  }

  // Fallback: force a routed path through downsampled waypoints.
  if (!coordinates || coordinates.length < 2) {
    const waypoints = downsampleWaypoints(points, 18);
    const coordinateString = waypoints.map((point) => `${point.lon},${point.lat}`).join(";");
    const routeUrl =
      `${base}/route/v1/foot/${coordinateString}` + "?overview=full&geometries=geojson&steps=true";
    const routeResponse = await fetch(routeUrl);
    if (!routeResponse.ok) {
      coordinates = undefined;
    } else {
      const routePayload = (await routeResponse.json()) as {
        routes?: Array<{
          distance?: number;
          legs?: Array<{ steps?: OsrmStep[] }>;
          geometry?: { coordinates?: [number, number][] };
        }>;
      };
      const bestRoute = routePayload.routes?.[0];
      coordinates = bestRoute?.geometry?.coordinates;
      distanceMeters = bestRoute?.distance;
      const routeSteps = bestRoute?.legs?.flatMap((leg) => leg.steps ?? []) ?? [];
      if (routeSteps.length) {
        snappedSegments = segmentsFromOsrmSteps(routeSteps);
      }
    }
  }

  // Final fallback: pairwise routing between consecutive points.
  if (!coordinates || coordinates.length < 2) {
    const pairwisePoints = downsampleWaypoints(points, 24);
    const merged: [number, number][] = [];
    const mergedSegments: GeneratedRoute["segments"] = [];
    let totalDistance = 0;

    for (let i = 0; i < pairwisePoints.length - 1; i += 1) {
      const result = await routeBetween(pairwisePoints[i], pairwisePoints[i + 1]);
      const chunk = result?.geometry?.coordinates;
      if (!chunk || chunk.length < 2) {
        continue;
      }
      totalDistance += result?.distance ?? 0;
      const steps = result?.legs?.flatMap((leg) => leg.steps ?? []) ?? [];
      if (steps.length) {
        mergedSegments.push(...segmentsFromOsrmSteps(steps));
      }
      if (merged.length === 0) {
        merged.push(...chunk);
      } else {
        merged.push(...chunk.slice(1));
      }
    }

    if (merged.length >= 2) {
      coordinates = merged;
      distanceMeters = totalDistance;
      if (mergedSegments.length) {
        snappedSegments = mergedSegments;
      }
    }
  }

  if (!coordinates || coordinates.length < 2) {
    throw new Error("OSRM snapping produced no usable geometry.");
  }

  const finalSegments =
    snappedSegments && snappedSegments.length ? snappedSegments : segmentsFromGeometry(coordinates);

  return {
    ...route,
    distanceMeters: Math.round(distanceMeters ?? route.distanceMeters),
    segments: finalSegments
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error("Request timed out while generating route."));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

export function buildServer() {
  const app = Fastify({ logger: true });
  const routeStore = new Map<string, GeneratedRoute>();
  const shortestPath = createShortestPathAdapter({
    provider: (process.env.ROUTING_PROVIDER as RoutingProvider | undefined) ?? "inmemory",
    osrmBaseUrl: process.env.OSRM_BASE_URL
  });
  const coverageShortestPath =
    (process.env.COVERAGE_ROUTING_PROVIDER as RoutingProvider | undefined) === "osrm"
      ? shortestPath
      : new InMemoryShortestPathAdapter();
  const streetCatalog = new OverpassStreetCatalogProvider({
    endpointUrl: process.env.OVERPASS_URL
  });
  const shouldSnapCoverage = process.env.SNAP_COVERAGE_TO_OSRM?.toLowerCase() !== "false";
  const requireCoverageSnap = process.env.REQUIRE_COVERAGE_SNAP?.toLowerCase() !== "false";
  const coverageTimeoutMs = Number(process.env.COVERAGE_TIMEOUT_MS ?? 20_000);
  const snapTimeoutMs = Number(process.env.SNAP_TIMEOUT_MS ?? 25_000);

  void app.register(cors, { origin: true });

  app.get("/health", async () => {
    return { status: "ok" };
  });

  app.get("/", async () => {
    return {
      service: "routeglyph-api",
      message: "RouteGlyph API is running."
    };
  });

  app.post("/routes/coverage", async (request, reply) => {
    const body = request.body as Partial<CoverageRouteRequest> | undefined;
    let route: GeneratedRoute;
    try {
      route = await withTimeout(
        generateCoverageRoute(
          {
            name: body?.name ?? "Coverage Route",
            targetStreets: body?.targetStreets ?? [],
            start: body?.start ?? fallbackStart,
            strategy: body?.strategy,
            maxDistanceMeters: body?.maxDistanceMeters,
            alphabet: body?.alphabet,
            area: body?.area
          },
          { shortestPath: coverageShortestPath, streetCatalog }
        ),
        coverageTimeoutMs
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("timed out")) {
        reply.status(504);
      } else {
        reply.status(500);
      }
      return {
        error: error instanceof Error ? error.message : "Coverage generation failed."
      };
    }

    if (shouldSnapCoverage && process.env.OSRM_BASE_URL) {
      try {
        route = await withTimeout(
          snapCoverageRouteToRoads(route, process.env.OSRM_BASE_URL),
          snapTimeoutMs
        );
        route = withCoverageSnapMeta(route, true);
      } catch (error) {
        const reason =
          error instanceof Error
            ? `OSRM snapping failed: ${error.message}`
            : "OSRM snapping failed; returning unsnapped fallback.";
        app.log.warn(reason);
        if (requireCoverageSnap) {
          reply.status(502);
          return { error: reason };
        }
        route = withCoverageSnapMeta(route, false, reason);
      }
    } else {
      if (requireCoverageSnap) {
        reply.status(400);
        return {
          error:
            "Coverage snap is required but SNAP_COVERAGE_TO_OSRM is disabled or OSRM_BASE_URL is not set."
        };
      }
      route = withCoverageSnapMeta(
        route,
        false,
        "SNAP_COVERAGE_TO_OSRM disabled or OSRM base URL not set."
      );
    }

    route = deriveCoverageFromFinalRoute(route);
    routeStore.set(route.id, route);

    return route;
  });

  app.post("/routes/shape", async (request) => {
    const body = request.body as Partial<ShapeRouteRequest> | undefined;
    const route = await generateShapeRoute(
      {
        name: body?.name ?? "Shape Route",
        points: body?.points ?? [fallbackStart, fallbackStart]
      },
      { shortestPath }
    );
    routeStore.set(route.id, route);

    return route;
  });

  app.get("/routes/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const route = routeStore.get(params.id);
    if (!route) {
      reply.status(404);
      return { error: "Route not found" };
    }
    return route;
  });

  app.get("/routes/:id/export.gpx", async (request, reply) => {
    const params = request.params as { id: string };
    const route = routeStore.get(params.id);
    if (!route) {
      reply.status(404);
      return { error: "Route not found" };
    }

    reply.header("Content-Type", "application/gpx+xml");
    reply.header("Content-Disposition", `attachment; filename="${route.id}.gpx"`);
    return toGpx(route);
  });

  return app;
}
