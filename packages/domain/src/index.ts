export type Coordinate = {
  lat: number;
  lon: number;
};

export type RouteMode = "coverage" | "shape";

export type RouteSegment = {
  from: Coordinate;
  to: Coordinate;
  streetName?: string;
};

export type GeneratedRoute = {
  id: string;
  mode: RouteMode;
  name: string;
  distanceMeters: number;
  createdAtIso: string;
  segments: RouteSegment[];
  coverage?: {
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
};

export type CoverageRouteRequest = {
  name: string;
  targetStreets: string[];
  start: Coordinate;
  strategy?: "target_streets" | "alphabet";
  maxDistanceMeters?: number;
  alphabet?: string[];
  area?: {
    center: Coordinate;
    radiusMeters: number;
  };
};

export type ShapeRouteRequest = {
  name: string;
  points: Coordinate[];
};
