# RouteGlyph

RouteGlyph is a web service for generating running routes for:

- Strava art (drawings made by your route path)
- Street coverage goals (hit specific streets, letters, or patterns)

## Project Structure

```text
apps/
  api/             Backend API service
  web/             Frontend map application
packages/
  domain/          Shared domain models and types
  route-engine/    Routing and optimization logic
  gpx/             GPX/TCX generation utilities
infra/
  docker/          Local service containers
  osm/             OSM import and graph build scripts
docs/              Product and technical docs
scripts/           Developer scripts
tests/
  integration/     End-to-end and integration tests
data/              Local datasets and generated artifacts
```

## MVP Goals

1. Draw or upload a shape and generate a runnable route.
2. Select target streets and generate an efficient coverage route.
3. Export generated routes as GPX.

## Next Steps

- Define API contract and route generation endpoints.
- Build first map screen with waypoint editing.
- Implement GPX export pipeline.
- Add first optimizer for target-street coverage.
