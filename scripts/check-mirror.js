import fs from "node:fs/promises";
import * as cheerio from "cheerio";

const SOURCE_URL = "https://jmcomicmi.net/";
const OUTPUT_FILE = "data/mirror.json";
const REQUEST_TIMEOUT = 15000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

function normalizeUrl(value, base = SOURCE_URL) {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = "";
    return url.origin + (url.pathname === "/" ? "" : url.pathname.replace(/\/$/, ""));
  } catch {
    return null;
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function sectionKey(text) {
  const normalized = text.replace(/\s+/g, "").toLowerCase();
  if (/(国际通用网络|國際通用網路|国际通用网域|國際通用網域)/.test(normalized)) return "global";
  if (/(内地网络|內地網路|内地网域|內地網域)/.test(normalized)) return "china";
  if (/分流1/.test(normalized)) return "flow1";
  if (/分流2/.test(normalized)) return "flow2";
  return null;
}

function looksLikeHeading($, el) {
  const tag = String(el.tagName || "").toLowerCase();
  const text = $(el).clone().children().remove().end().text().trim();
  return /^(h[1-6]|strong|b|p|div|span|td|th|li)$/.test(tag) && text.length <= 40 && sectionKey(text);
}

function extractSections(html) {
  const $ = cheerio.load(html);
  const result = { global: [], china: [], flow1: [], flow2: [] };
  const headings = [];

  $("body *").each((_, el) => {
    if (looksLikeHeading($, el)) headings.push(el);
  });

  for (const heading of headings) {
    const key = sectionKey($(heading).text());
    if (!key) continue;

    const found = [];
    const addLinks = (root) => {
      $(root).find("a[href]").each((_, a) => {
        const url = normalizeUrl($(a).attr("href"));
        if (url) found.push(url);
      });
    };

    // Links in the heading/container itself.
    addLinks(heading);
    addLinks($(heading).parent());

    // Links in following siblings until the next recognised section.
    let node = $(heading).parent();
    for (let i = 0; i < 12; i++) {
      node = node.next();
      if (!node.length) break;
      if (sectionKey($(node).text().trim())) break;
      addLinks(node);
    }

    result[key].push(...found);
  }

  for (const key of Object.keys(result)) result[key] = unique(result[key]);

  return { $, result };
}

async function checkUrl(url) {
  const started = Date.now();
  try {
    let response = await fetchWithTimeout(url, { method: "HEAD" });
    if ([405, 403, 501].includes(response.status)) {
      response = await fetchWithTimeout(url, { method: "GET", headers: { Range: "bytes=0-0" } });
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
  if (!response.ok) throw new Error(`Mirror page returned HTTP ${response.status}`);
  const html = await response.text();
  const { result } = extractSections(html);

  const total = Object.values(result).reduce((n, list) => n + list.length, 0);
  if (total === 0) throw new Error("No mirror URLs found; refusing to overwrite mirror.json");

  // De-duplicate URLs across categories while preserving the page's category mapping.
  const allUrls = unique(Object.values(result).flat());
  const checked = {};
  for (const url of allUrls) {
    console.log(`Checking ${url}`);
    checked[url] = await checkUrl(url);
    await sleep(250);
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
  console.log(JSON.stringify(data, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
