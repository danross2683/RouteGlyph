import type { CoverageRouteRequest, GeneratedRoute, ShapeRouteRequest } from "@routeglyph/domain";
import { optimizeCoverageRoute, optimizeShapeRoute } from "./optimizers.js";

export * from "./adapter-factory.js";
export * from "./graph.js";
export * from "./osrm-adapter.js";
export * from "./optimizers.js";
export * from "./scoring.js";
export * from "./shortest-path.js";
export * from "./street-catalog.js";

export async function generateCoverageRoute(
  request: CoverageRouteRequest,
  options?: Parameters<typeof optimizeCoverageRoute>[1]
): Promise<GeneratedRoute> {
  return optimizeCoverageRoute(request, options);
}

export async function generateShapeRoute(
  request: ShapeRouteRequest,
  options?: Parameters<typeof optimizeShapeRoute>[1]
): Promise<GeneratedRoute> {
  return optimizeShapeRoute(request, options);
}
