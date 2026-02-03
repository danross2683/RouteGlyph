import type { GeneratedRoute } from "@routeglyph/domain";

export function toGpx(route: GeneratedRoute): string {
  const points = route.segments.flatMap((segment) => [segment.from, segment.to]);
  const trackPoints = points
    .map((point) => `<trkpt lat="${point.lat}" lon="${point.lon}" />`)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="RouteGlyph"><trk><name>${route.name}</name><trkseg>${trackPoints}</trkseg></trk></gpx>`;
}
