
const http = require("node:http");

const PORT = process.env.PORT || 3000;
const ROBLOX_API =
  "https://apis.roblox.com/toolbox-service/v2/assets:search";

const ALLOWED_TYPES = new Set([
  "Model",
  "Decal",
  "Audio",
  "MeshPart",
  "Video",
  "FontFamily",
]);

const cache = new Map();
const CACHE_TTL = 60_000;
const MAX_CACHE = 100;

function send(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

function getCached(key) {
  const entry = cache.get(key);

  if (!entry) return null;

  if (Date.now() - entry.time > CACHE_TTL) {
    cache.delete(key);
    return null;
  }

  return entry.data;
}

function saveCache(key, data) {
  if (cache.size >= MAX_CACHE) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }

  cache.set(key, {
    time: Date.now(),
    data,
  });
}

const server = http.createServer(async (req, res) => {
  let url;

  try {
    url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  } catch {
    return send(res, 400, { error: "Invalid URL" });
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  if (req.method !== "GET") {
    return send(res, 405, { error: "Method not allowed" });
  }

  if (url.pathname === "/") {
    return send(res, 200, {
      name: "XunknownX CreatorStoreAPI",
      status: "online",
      endpoints: [
        "/health",
        "/search?q=tree&type=Model",
      ],
      supportedTypes: [...ALLOWED_TYPES],
    });
  }

  if (url.pathname === "/health") {
    return send(res, 200, {
      ok: true,
      service: "XunknownX CreatorStoreAPI",
      time: new Date().toISOString(),
    });
  }

  if (url.pathname !== "/search") {
    return send(res, 404, {
      error: "Endpoint not found",
    });
  }

  const query = (url.searchParams.get("q") || "").trim();
  const type = url.searchParams.get("type") || "Model";
  const pageToken = url.searchParams.get("pageToken") || "";

  if (!query) {
    return send(res, 400, {
      error: "Missing search keyword",
      usage: "/search?q=tree&type=Model",
    });
  }

  if (query.length > 100) {
    return send(res, 400, {
      error: "Query is too long",
    });
  }

  if (!ALLOWED_TYPES.has(type)) {
    return send(res, 400, {
      error: "Unsupported asset type",
      allowedTypes: [...ALLOWED_TYPES],
    });
  }

  if (pageToken.length > 2000) {
    return send(res, 400, {
      error: "Page token is too long",
    });
  }

  const cacheKey = JSON.stringify([
    query,
    type,
    pageToken,
  ]);

  const cached = getCached(cacheKey);

  if (cached) {
    return send(res, 200, {
      ...cached,
      cached: true,
    });
  }

  const params = new URLSearchParams({
    searchCategoryType: type,
    query,
    maxPageSize: "25",
    searchView: "Core",
  });

  if (pageToken) {
    params.set("pageToken", pageToken);
  }

  try {
    const response = await fetch(
      `${ROBLOX_API}?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(12000),
      }
    );

    if (!response.ok) {
      const status = response.status;

      return send(res, status === 429 ? 429 : 502, {
        error: "Roblox Creator Store request failed",
        upstreamStatus: status,
        retryable: status === 429 || status >= 500,
        message:
          status === 401 || status === 403
            ? "Roblox may require authorization or deny access."
            : status === 429
            ? "Rate limit reached. Wait before trying again."
            : "Check Roblox API availability and response.",
      });
    }

    const body = await response.json();

    const assets = Array.isArray(body.creatorStoreAssets)
      ? body.creatorStoreAssets
      : [];

    const result = {
      query,
      type,
      totalResults: body.totalResults ?? null,
      count: assets.length,
      nextPageToken: body.nextPageToken || null,
      results: assets.map((asset) => ({
        id: asset.id ?? asset.assetId ?? null,
        name: asset.name ?? "Unnamed asset",
        description: asset.description ?? null,
      })),
      cached: false,
    };

    saveCache(cacheKey, result);

    return send(res, 200, result);
  } catch (error) {
    return send(res, 502, {
      error: "Could not reach Roblox Creator Store",
      detail:
        error.name === "TimeoutError"
          ? "Request timed out"
          : "Network or invalid response",
    });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `XunknownX CreatorStoreAPI running on port ${PORT}`
  );
});
    
