import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";

type Coordinate = { lat: number; lon: number };
type RouteSegment = { from: Coordinate; to: Coordinate; streetName?: string };
type CoverageMeta = {
  strategy: "target_streets" | "alphabet";
  lettersCovered: string[];
  plannedLettersCovered?: string[];
  lettersRequested: string[];
  matchedStreetCount: number;
  maxDistanceMeters?: number;
  estimatedElevationGainMeters: number;
  duplicateStreetPenalty: number;
  uniqueStreetCount: number;
  snappedToRoads?: boolean;
  snapReason?: string;
};
type GeneratedRoute = {
  id: string;
  mode: "coverage" | "shape";
  name: string;
  distanceMeters: number;
  createdAtIso: string;
  segments: RouteSegment[];
  coverage?: CoverageMeta;
};

type SourceData = Parameters<GeoJSONSource["setData"]>[0];

const apiBase = "http://localhost:4000";

function parsePoints(input: string): Coordinate[] {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(",").map((value) => value.trim()))
    .filter((pair) => pair.length === 2)
    .map(([lat, lon]) => ({ lat: Number(lat), lon: Number(lon) }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon));
}

function toPreviewPoints(route: GeneratedRoute | null, fallbackInput: string) {
  if (route && Array.isArray(route.segments) && route.segments.length > 0) {
    const first = route.segments[0]?.from;
    const rest = route.segments.map((segment) => segment.to);
    return first ? [first, ...rest] : [];
  }
  return parsePoints(fallbackInput);
}

function toRouteGeoJson(points: Coordinate[]): SourceData {
  return {
    type: "FeatureCollection",
    features:
      points.length > 1
        ? [
            {
              type: "Feature",
              geometry: {
                type: "LineString",
                coordinates: points.map((point) => [point.lon, point.lat])
              },
              properties: {}
            }
          ]
        : []
  };
}

function toPointGeoJson(point: Coordinate): SourceData {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [point.lon, point.lat]
        },
        properties: {}
      }
    ]
  };
}

function toAreaGeoJson(center: Coordinate, radiusMeters: number): SourceData {
  const coordinates: [number, number][] = [];
  const earthRadiusMeters = 6378137;
  for (let i = 0; i <= 64; i += 1) {
    const angle = (i / 64) * 2 * Math.PI;
    const latOffset = (radiusMeters / earthRadiusMeters) * (180 / Math.PI) * Math.cos(angle);
    const lonOffset =
      ((radiusMeters / earthRadiusMeters) * (180 / Math.PI) * Math.sin(angle)) /
      Math.cos((center.lat * Math.PI) / 180);
    coordinates.push([center.lon + lonOffset, center.lat + latOffset]);
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [coordinates]
        },
        properties: {}
      }
    ]
  };
}

function updateSource(map: MapLibreMap, sourceId: string, data: SourceData) {
  const source = map.getSource(sourceId) as GeoJSONSource | undefined;
  source?.setData(data);
}

export default function App() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

  const [routeName, setRouteName] = useState("North Yorkshire Alphabet");
  const [activeMode, setActiveMode] = useState<"coverage" | "shape">("coverage");

  const [coverageStrategy, setCoverageStrategy] = useState<"alphabet" | "target_streets">(
    "alphabet"
  );
  const [targetStreet, setTargetStreet] = useState("");
  const [targetStreets, setTargetStreets] = useState<string[]>(["Albion Rd", "Baker St"]);
  const [maxDistanceKm, setMaxDistanceKm] = useState(12);
  const [startLat, setStartLat] = useState(54.0);
  const [startLon, setStartLon] = useState(-1.55);
  const [areaRadiusKm, setAreaRadiusKm] = useState(4);

  const [shapePointsInput, setShapePointsInput] = useState(
    "54.0000,-1.5500\n54.0100,-1.5200\n54.0200,-1.5300"
  );

  const [route, setRoute] = useState<GeneratedRoute | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewPoints = useMemo(
    () => toPreviewPoints(route, shapePointsInput),
    [route, shapePointsInput]
  );
  const uniqueStreetNames = useMemo(() => {
    if (!route) {
      return [];
    }
    return [
      ...new Set(route.segments.map((segment) => segment.streetName?.trim()).filter(Boolean))
    ];
  }, [route]);
  const routeStreetLetters = useMemo(() => {
    return [
      ...new Set(
        uniqueStreetNames
          .map((name) => name?.toUpperCase().match(/[A-Z]/)?.[0])
          .filter((value): value is string => !!value)
      )
    ].sort();
  }, [uniqueStreetNames]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors"
          }
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }]
      },
      center: [startLon, startLat],
      zoom: 12
    });

    map.on("load", () => {
      map.addSource("area", {
        type: "geojson",
        data: toAreaGeoJson({ lat: startLat, lon: startLon }, areaRadiusKm * 1000)
      });
      map.addLayer({
        id: "area-fill",
        type: "fill",
        source: "area",
        paint: {
          "fill-color": "#2c5b9f",
          "fill-opacity": 0.12
        }
      });
      map.addLayer({
        id: "area-line",
        type: "line",
        source: "area",
        paint: {
          "line-color": "#2c5b9f",
          "line-width": 2
        }
      });

      map.addSource("route", {
        type: "geojson",
        data: toRouteGeoJson(previewPoints)
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        paint: {
          "line-color": "#db5d3b",
          "line-width": 4
        }
      });

      map.addSource("start", {
        type: "geojson",
        data: toPointGeoJson({ lat: startLat, lon: startLon })
      });
      map.addLayer({
        id: "start-point",
        type: "circle",
        source: "start",
        paint: {
          "circle-radius": 6,
          "circle-color": "#1f3d73",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2
        }
      });
    });

    map.on("click", (event) => {
      const lat = Number(event.lngLat.lat.toFixed(6));
      const lon = Number(event.lngLat.lng.toFixed(6));
      setStartLat(lat);
      setStartLon(lon);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [areaRadiusKm, previewPoints, startLat, startLon]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) {
      return;
    }

    updateSource(map, "area", toAreaGeoJson({ lat: startLat, lon: startLon }, areaRadiusKm * 1000));
    updateSource(map, "route", toRouteGeoJson(previewPoints));
    updateSource(map, "start", toPointGeoJson({ lat: startLat, lon: startLon }));
    map.setCenter([startLon, startLat]);
  }, [areaRadiusKm, previewPoints, startLat, startLon]);

  async function createCoverageRoute() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${apiBase}/routes/coverage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: routeName || "Coverage Route",
          strategy: coverageStrategy,
          targetStreets,
          maxDistanceMeters: Math.round(maxDistanceKm * 1000),
          start: { lat: startLat, lon: startLon },
          area: {
            center: { lat: startLat, lon: startLon },
            radiusMeters: Math.round(areaRadiusKm * 1000)
          }
        })
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error ?? `Coverage route failed (${response.status}).`);
      }
      const data = (await response.json()) as GeneratedRoute;
      setRoute(data);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not generate coverage route. Is API running on port 4000?"
      );
    } finally {
      setLoading(false);
    }
  }

  async function createShapeRoute() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${apiBase}/routes/shape`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: routeName || "Shape Route",
          points: parsePoints(shapePointsInput)
        })
      });
      if (!response.ok) {
        throw new Error(`Shape route failed (${response.status}).`);
      }
      const data = (await response.json()) as GeneratedRoute;
      setRoute(data);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not generate shape route. Is API running on port 4000?"
      );
    } finally {
      setLoading(false);
    }
  }

  function addStreet() {
    const value = targetStreet.trim();
    if (!value) return;
    setTargetStreets((prev) => [...prev, value]);
    setTargetStreet("");
  }

  return (
    <main className="app">
      <header className="hero">
        <p className="eyebrow">RouteGlyph</p>
        <h1>Draw routes, collect letters.</h1>
        <p>Click map to set start/area center, then optimize for A-Z coverage.</p>
      </header>

      <section className="workspace">
        <article className="panel controls">
          <h2>Route Builder</h2>
          <label>
            Route name
            <input value={routeName} onChange={(event) => setRouteName(event.target.value)} />
          </label>

          <div className="mode">
            <button
              className={activeMode === "coverage" ? "active" : ""}
              onClick={() => setActiveMode("coverage")}
              type="button"
            >
              Coverage
            </button>
            <button
              className={activeMode === "shape" ? "active" : ""}
              onClick={() => setActiveMode("shape")}
              type="button"
            >
              Shape
            </button>
          </div>

          {activeMode === "coverage" ? (
            <>
              <label>
                Goal
                <select
                  value={coverageStrategy}
                  onChange={(event) =>
                    setCoverageStrategy(event.target.value as "alphabet" | "target_streets")
                  }
                >
                  <option value="alphabet">Alphabet streets (A-Z)</option>
                  <option value="target_streets">Target street list</option>
                </select>
              </label>
              <label>
                Start latitude
                <input
                  type="number"
                  step="0.0001"
                  value={startLat}
                  onChange={(event) => setStartLat(Number(event.target.value))}
                />
              </label>
              <label>
                Start longitude
                <input
                  type="number"
                  step="0.0001"
                  value={startLon}
                  onChange={(event) => setStartLon(Number(event.target.value))}
                />
              </label>
              <label>
                Area radius (km)
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={areaRadiusKm}
                  onChange={(event) => setAreaRadiusKm(Number(event.target.value))}
                />
              </label>
              <label>
                Max distance (km)
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={maxDistanceKm}
                  onChange={(event) => setMaxDistanceKm(Number(event.target.value))}
                />
              </label>

              {coverageStrategy === "target_streets" ? (
                <>
                  <label>
                    Target street
                    <div className="row">
                      <input
                        value={targetStreet}
                        onChange={(event) => setTargetStreet(event.target.value)}
                        placeholder="Example: Castle Road"
                      />
                      <button onClick={addStreet} type="button">
                        Add
                      </button>
                    </div>
                  </label>
                  <div className="chips">
                    {targetStreets.map((street) => (
                      <span key={street}>{street}</span>
                    ))}
                  </div>
                </>
              ) : null}

              <button onClick={createCoverageRoute} disabled={loading} type="button">
                {loading ? "Generating..." : "Generate coverage route"}
              </button>
            </>
          ) : (
            <>
              <label>
                Shape points (lat,lon per line)
                <textarea
                  rows={7}
                  value={shapePointsInput}
                  onChange={(event) => setShapePointsInput(event.target.value)}
                />
              </label>
              <button onClick={createShapeRoute} disabled={loading} type="button">
                {loading ? "Generating..." : "Generate shape route"}
              </button>
            </>
          )}
          {error ? <p className="error">{error}</p> : null}
        </article>

        <article className="panel map">
          <h2>Map</h2>
          <div className="map-canvas" ref={mapContainerRef} />
          <p className="hint">Click map to move start/area center.</p>
        </article>

        <article className="panel details">
          <h2>Route Details</h2>
          {route ? (
            <>
              <p>
                <strong>{route.name}</strong> ({route.mode})
              </p>
              <p>{(route.distanceMeters / 1000).toFixed(2)} km</p>
              <p>{route.segments.length} segments</p>
              {route.coverage ? (
                <>
                  <p>
                    Letters covered: {route.coverage.lettersCovered.length}
                    {route.coverage.lettersRequested.length
                      ? ` / ${route.coverage.lettersRequested.length}`
                      : ""}
                  </p>
                  {route.coverage.lettersCovered.length ? (
                    <p className="letter-row">{route.coverage.lettersCovered.join(" ")}</p>
                  ) : null}
                  {route.coverage.plannedLettersCovered?.length ? (
                    <p className="hint">
                      Planned letters: {route.coverage.plannedLettersCovered.join(" ")}
                    </p>
                  ) : null}
                  <p>
                    Letters from route streets: {routeStreetLetters.length}
                    {route.coverage.lettersRequested.length
                      ? ` / ${route.coverage.lettersRequested.length}`
                      : ""}
                  </p>
                  {routeStreetLetters.length ? (
                    <p className="letter-row">{routeStreetLetters.join(" ")}</p>
                  ) : null}
                  <p>Est. elevation gain: {route.coverage.estimatedElevationGainMeters} m</p>
                  <p>Unique streets: {route.coverage.uniqueStreetCount}</p>
                  <p>Duplicate penalty: {route.coverage.duplicateStreetPenalty}</p>
                  <p>Snap status: {route.coverage.snappedToRoads ? "snapped" : "unsnapped"}</p>
                  {route.coverage.snapReason ? (
                    <p className="hint">{route.coverage.snapReason}</p>
                  ) : null}
                </>
              ) : null}
              <a href={`${apiBase}/routes/${route.id}/export.gpx`} target="_blank" rel="noreferrer">
                Export GPX
              </a>
              {uniqueStreetNames.length ? (
                <>
                  <p>Route streets:</p>
                  <p className="street-list">{uniqueStreetNames.slice(0, 20).join(", ")}</p>
                </>
              ) : null}
            </>
          ) : (
            <p>Generate a route to see stats and export options.</p>
          )}
        </article>
      </section>
    </main>
  );
}
