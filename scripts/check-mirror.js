import fs from "node:fs/promises";

const SOURCE_URL = "https://jmcomicmi.net/";
const OUTPUT_FILE = "data/mirror.json";
const REQUEST_TIMEOUT = 15000;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    return await fetch(url, {
      redirect: "follow",
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; JMHubMirrorBot/1.0; +https://github.com/Carolove7/jmhub)",
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeUrl(value) {
  if (!value) return null;

  let raw = value.trim();
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;

  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
    return url.origin + url.pathname;
  } catch {
    return null;
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function extractUrls(text) {
  // Handles both https://example.com and bare domains such as 18comic.vip.
  const matches = text.match(/(?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s<>'"，。；：]*)?/gi) || [];
  return unique(matches.map(normalizeUrl));
}

function classifyPageText(text) {
  const lines = text
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const result = {
    global: [],
    china: [],
    flow1: [],
    flow2: []
  };

  let section = null;

  for (const line of lines) {
    const compact = line.replace(/\s+/g, "").toLowerCase();

    if (/^(国际通用网域|國際通用網域|国际通用网络|國際通用網路)$/.test(compact)) {
      section = "global";
      continue;
    }

    // This is a separate section and must NOT be treated as the main/global site.
    if (/^(东南亚路线建议使用|東南亞路線建議使用|东南亚路线|東南亞路線)/.test(compact)) {
      section = null;
      continue;
    }

    if (/^(内地网域|內地網域|内地网络|內地網路)$/.test(compact)) {
      section = "china";
      continue;
    }

    if (/^分流\s*1$/.test(compact)) {
      section = "flow1";
      continue;
    }

    if (/^分流\s*2$/.test(compact)) {
      section = "flow2";
      continue;
    }

    if (!section) continue;

    result[section].push(...extractUrls(line));
  }

  for (const key of Object.keys(result)) {
    result[key] = unique(result[key]);
  }

  return result;
}

async function checkUrl(url) {
  const started = Date.now();

  try {
    let response = await fetchWithTimeout(url, { method: "HEAD" });

    if ([403, 405, 501].includes(response.status)) {
      response = await fetchWithTimeout(url, {
        method: "GET",
        headers: { Range: "bytes=0-0" }
      });
    }

    return {
      ok: response.status >= 200 && response.status < 400,
      status: response.status,
      final_url: response.url,
      latency_ms: Date.now() - started
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      final_url: null,
      latency_ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function main() {
  console.log(`Fetching ${SOURCE_URL}`);

  const response = await fetchWithTimeout(SOURCE_URL);
  if (!response.ok) {
    throw new Error(`Mirror page returned HTTP ${response.status}`);
  }

  const html = await response.text();

  // The page currently exposes the addresses as visible text rather than
  // reliable <a href> elements, so parse the rendered text instead of links.
  const pageText = html
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");

  const result = classifyPageText(pageText);

  const total = Object.values(result).reduce((n, list) => n + list.length, 0);
  if (total === 0) {
    console.error("No mirror URLs found. Page text preview:");
    console.error(pageText.slice(0, 5000));
    throw new Error("No mirror URLs found; refusing to overwrite mirror.json");
  }

  console.log("Discovered mirrors:");
  console.log(JSON.stringify(result, null, 2));

  const allUrls = unique(Object.values(result).flat());
  const checked = {};

  for (const url of allUrls) {
    console.log(`Checking ${url}`);
    checked[url] = await checkUrl(url);
  }

  const data = {
    source: SOURCE_URL,
    global: result.global,
    china: result.china,
    flow1: result.flow1,
    flow2: result.flow2,
    checked,
    updated_at: new Date().toISOString()
  };

  await fs.mkdir("data", { recursive: true });
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(data, null, 2) + "\n", "utf8");

  console.log("Mirror data updated successfully.");
  console.log(JSON.stringify(data, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
