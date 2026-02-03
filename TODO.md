# TODO

## Foundation

- [x] Pick monorepo tooling (pnpm/turbo or npm workspaces)
- [x] Set up `apps/api` service skeleton
- [x] Set up `apps/web` frontend skeleton
- [x] Add linting, formatting, and commit hooks

## Routing Engine

- [x] Define road graph model for run-safe OSM edges
- [x] Build shortest path adapter (OSRM or GraphHopper)
- [x] Implement objective scoring (distance, elevation, turns, safety)
- [x] Add street coverage optimizer (visit target edges)
- [x] Add shape matching optimizer (drawn path -> road network)
- [x] Add in-memory shortest-path adapter baseline (Dijkstra)

## API

- [x] `POST /routes/coverage` (target streets -> route)
- [x] `POST /routes/shape` (polyline/SVG -> route)
- [x] `GET /routes/:id` (load generated route)
- [x] `GET /routes/:id/export.gpx` (download GPX)

## Frontend

- [x] Map view with draw/edit tools
- [ ] Upload SVG/polyline input flow
- [ ] Street selection mode (click-to-target)
- [x] Route preview with distance/elevation details
- [x] Export/download actions
- [x] Prototype builder UI for coverage + shape modes
- [x] Area + distance constrained alphabet coverage controls

## Quality

- [ ] Integration tests for API + optimizer
- [ ] Route validity checks (connected, runnable, no illegal segments)
- [ ] Basic performance budget for route generation time
- [x] Surface route quality metrics (elevation estimate + duplicate penalty)

## Docs

- [ ] Architecture decision record for routing stack
- [x] Local development setup docs
- [ ] Product spec for MVP behavior and constraints
