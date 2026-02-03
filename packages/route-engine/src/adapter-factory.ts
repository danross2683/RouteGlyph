import { OsrmShortestPathAdapter } from "./osrm-adapter.js";
import { InMemoryShortestPathAdapter, type ShortestPathAdapter } from "./shortest-path.js";

export type RoutingProvider = "inmemory" | "osrm";

export type ShortestPathAdapterConfig = {
  provider?: RoutingProvider;
  osrmBaseUrl?: string;
};

export function createShortestPathAdapter(
  config: ShortestPathAdapterConfig = {}
): ShortestPathAdapter {
  const provider = config.provider ?? "inmemory";

  if (provider === "osrm" && config.osrmBaseUrl) {
    return new OsrmShortestPathAdapter({
      baseUrl: config.osrmBaseUrl,
      profile: "foot",
      fallback: new InMemoryShortestPathAdapter()
    });
  }

  return new InMemoryShortestPathAdapter();
}
