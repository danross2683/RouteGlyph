# TODO

## Foundation

- [ ] Pick monorepo tooling (pnpm/turbo or npm workspaces)
- [ ] Set up `apps/api` service skeleton
- [ ] Set up `apps/web` frontend skeleton
- [ ] Add linting, formatting, and commit hooks

## Routing Engine

- [ ] Define road graph model for run-safe OSM edges
- [ ] Build shortest path adapter (OSRM or GraphHopper)
- [ ] Implement objective scoring (distance, elevation, turns, safety)
- [ ] Add street coverage optimizer (visit target edges)
- [ ] Add shape matching optimizer (drawn path -> road network)

## API

- [ ] `POST /routes/coverage` (target streets -> route)
- [ ] `POST /routes/shape` (polyline/SVG -> route)
- [ ] `GET /routes/:id` (load generated route)
- [ ] `GET /routes/:id/export.gpx` (download GPX)

## Frontend

- [ ] Map view with draw/edit tools
- [ ] Upload SVG/polyline input flow
- [ ] Street selection mode (click-to-target)
- [ ] Route preview with distance/elevation details
- [ ] Export/download actions

## Quality

- [ ] Integration tests for API + optimizer
- [ ] Route validity checks (connected, runnable, no illegal segments)
- [ ] Basic performance budget for route generation time

## Docs

- [ ] Architecture decision record for routing stack
- [ ] Local development setup docs
- [ ] Product spec for MVP behavior and constraints
