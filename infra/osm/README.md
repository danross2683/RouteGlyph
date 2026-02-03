# OSRM Local Setup

Use this when you want `ROUTING_PROVIDER=osrm`.

## 1) Prepare data folder

Create `data/osrm` and place your OSM extract there as:

- `data/osrm/region.osm.pbf`

## 2) Build OSRM graph files

Run from repository root:

```bash
docker compose -f infra/docker/docker-compose.osrm.yml run --rm osrm-tools "osrm-extract -p /opt/foot.lua /data/region.osm.pbf"
docker compose -f infra/docker/docker-compose.osrm.yml run --rm osrm-tools "osrm-partition /data/region.osrm"
docker compose -f infra/docker/docker-compose.osrm.yml run --rm osrm-tools "osrm-customize /data/region.osrm"
```

Or use helper script:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\osrm.ps1 -Action prep
```

## 3) Start OSRM server

```bash
docker compose -f infra/docker/docker-compose.osrm.yml up -d osrm
```

Or:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\osrm.ps1 -Action up
```

OSRM is available at `http://localhost:5000`.

## 4) Point API to OSRM

Set environment variables before starting API:

```bash
ROUTING_PROVIDER=osrm
OSRM_BASE_URL=http://localhost:5000
```

## 5) Stop OSRM

```bash
docker compose -f infra/docker/docker-compose.osrm.yml down
```

Or:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\osrm.ps1 -Action down
```

## Helper script actions

- `prep`: extract + partition + customize
- `up`: start OSRM
- `down`: stop OSRM
- `rebuild`: prep then up
- `status`: show compose service status
