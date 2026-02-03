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

## Getting Started

```bash
npm install
```

### Startup Steps (PowerShell)

From repo root, run these in separate terminals.

1. Start OSRM:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\osrm.ps1 -Action up
```

1. Start API:

```powershell
$env:ROUTING_PROVIDER="osrm"
$env:COVERAGE_ROUTING_PROVIDER="inmemory"
$env:OSRM_BASE_URL="http://localhost:5000"
$env:OVERPASS_URL="https://overpass-api.de/api/interpreter"
$env:SNAP_COVERAGE_TO_OSRM="true"
$env:REQUIRE_COVERAGE_SNAP="true"
$env:COVERAGE_TIMEOUT_MS="60000"
$env:SNAP_TIMEOUT_MS="45000"
npm run dev:api
```

`COVERAGE_ROUTING_PROVIDER="inmemory"` is recommended for responsiveness; coverage output is still road-snapped via OSRM before export when snapping is enabled.

1. Start Web:

```powershell
npm run dev:web
```

Open:

- Web: `http://localhost:5173`
- API health: `http://localhost:4000/health`

Optional API routing provider environment variables:

- `ROUTING_PROVIDER=inmemory|osrm` (default: `inmemory`)
- `COVERAGE_ROUTING_PROVIDER=inmemory|osrm` (default: `inmemory`)
- `OSRM_BASE_URL=http://localhost:5000` (required when using `osrm`)
- `OVERPASS_URL=https://overpass-api.de/api/interpreter` (optional OSM street-name source)
- `SNAP_COVERAGE_TO_OSRM=true|false` (default: `true`, road-snaps coverage output before GPX export)
- `REQUIRE_COVERAGE_SNAP=true|false` (default: `true`, fail coverage generation if snapping fails)
- `COVERAGE_TIMEOUT_MS=20000` (default: `20000`, max coverage optimization time in ms)
- `SNAP_TIMEOUT_MS=25000` (default: `25000`, max snap time in ms before fallback)

Coverage responses include `coverage.snappedToRoads` and `coverage.snapReason` so you can verify whether OSRM snapping succeeded.
Coverage letter metrics are recalculated from the final route street names (post-snap) and include `plannedLettersCovered` for diagnostics.

## Local OSRM

Quick start:

```bash
docker compose -f infra/docker/docker-compose.osrm.yml run --rm osrm-tools "osrm-extract -p /opt/foot.lua /data/region.osm.pbf"
docker compose -f infra/docker/docker-compose.osrm.yml run --rm osrm-tools "osrm-partition /data/region.osrm"
docker compose -f infra/docker/docker-compose.osrm.yml run --rm osrm-tools "osrm-customize /data/region.osrm"
docker compose -f infra/docker/docker-compose.osrm.yml up -d osrm
```

Full setup details are in `infra/osm/README.md`.
PowerShell helper is available at `scripts/osrm.ps1`.

## Current Endpoints

- `GET /health`
- `POST /routes/coverage`
- `POST /routes/shape`
- `GET /routes/:id`
- `GET /routes/:id/export.gpx`

`POST /routes/coverage` supports:

- `strategy`: `alphabet` or `target_streets`
- `maxDistanceMeters`: distance cap for optimization
- `start`: route start coordinate
- `area`: center/radius to constrain search graph
- coverage generation uses timeout + candidate caps to avoid hanging requests

## Routing Engine Status

- Includes a run-safe road graph model and in-memory shortest path baseline.
- Includes a pluggable shortest-path adapter with OSRM support and in-memory fallback.
- Coverage optimizer supports alphabet and target-street strategies with max-distance cap.
- Coverage optimizer can harvest real street names from OSM Overpass for the selected area.
- Alphabet coverage prioritizes harder-to-find letters and penalizes duplicate street reuse.
- Alphabet mode uses "touch" coverage (reach a street anchor) rather than full-street traversal.
- Coverage and shape endpoints now use graph-based optimizers.
- Uses weighted route scoring for distance, elevation, turns, and safety.
- Uses a seeded local graph for now (OSM/OSRM/GraphHopper integration next).

## Next Steps

- Swap seeded graph with real OSM graph ingestion.
- Add persistent route storage.
- Upgrade prototype preview to a real interactive map layer.
