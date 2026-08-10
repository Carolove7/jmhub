const DATA_URLS = [
  "https://g.blfrp.cn/https://raw.githubusercontent.com/Carolove7/jmhub/main/data/mirror.json",
  "https://raw.githubusercontent.com/Carolove7/jmhub/main/data/mirror.json",
];
const MAIN_HOSTS = ["18comic.vip", "18comic.ink"];
const SOUTHEAST_ASIA_HOSTS = ["jmcomic-zzz.one", "jmcomic-zzz.org"];
const SOURCE_HOSTS = [...MAIN_HOSTS, ...SOUTHEAST_ASIA_HOSTS];
const RULE_IDS = [2001, 2002, 2003, 2004];
const OLD_RULE_IDS = [1001, 1002, 1003, 1004];
const REFRESH_TTL = 30 * 60 * 1000;

// 这些域名属于「主站 / 东南亚线路」：候选镜像若 301 跳到它们，说明该镜像域名已被弃用，
// 继续把它当作目标会与服务端重定向形成死循环。
const BLOCKED_REDIRECT_HOSTS = new Set([...MAIN_HOSTS, ...SOUTHEAST_ASIA_HOSTS]);

function candidateOrigins(data) {
  const values = [...(data?.china || []), ...(data?.flow1 || []), ...(data?.flow2 || [])];
  const blocked = new Set(["18comic.vip", "18comic.ink"]);
  const seen = new Set();
  return values.flatMap((value) => {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "https:" || blocked.has(parsed.hostname) || seen.has(parsed.origin)) return [];
      seen.add(parsed.origin);
      return [parsed.origin];
    } catch {
      return [];
    }
  });
}

// 根据 Actions 检测数据判断该候选是否已失效：明确 3xx 跳回主站/东南亚线路即视为弃用。
// 注意：仅依据「重定向到非中国区」这一明确信号，不臆断其他失败，避免误杀真正可用的内地镜像。
function isLikelyDead(origin, data) {
  const info = data?.checked?.[origin];
  if (!info || typeof info.status !== "number") return false;
  if (info.status >= 300 && info.status < 400 && info.redirect_to) {
    try {
      const to = new URL(info.redirect_to).hostname;
      if (BLOCKED_REDIRECT_HOSTS.has(to)) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

async function getTarget(data) {
  const { manualTarget } = await chrome.storage.local.get("manualTarget");
  const all = candidateOrigins(data);
  // 手动指定优先（用户在弹窗里明确选择，尊重其意图）
  if (manualTarget && all.includes(manualTarget)) return manualTarget;
  // 自动模式：排除明显失效（跳回主站/东南亚）的候选，取第一个可用的
  const usable = all.filter((o) => !isLikelyDead(o, data));
  return usable[0] || null;
}

async function applyNetworkRules(data) {
  const { enabled } = await chrome.storage.local.get("enabled");
  const target = await getTarget(data);
  // 仅当启用且有可用候选时才安装改写规则；否则不拦截，放行主站，避免重定向死循环。
  const addRules =
    enabled === false || !target
      ? []
      : SOURCE_HOSTS.map((host, index) => ({
          id: RULE_IDS[index],
          priority: 100,
          action: {
            type: "redirect",
            redirect: { transform: { scheme: "https", host: new URL(target).hostname } },
          },
          condition: { urlFilter: `||${host}^`, resourceTypes: ["main_frame"] },
        }));
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const same =
    existing.length === addRules.length &&
    existing.every((rule) => {
      const expected = addRules.find((item) => item.id === rule.id);
      return expected && JSON.stringify(rule.action) === JSON.stringify(expected.action);
    });
  if (!same)
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [...RULE_IDS, ...OLD_RULE_IDS],
      addRules,
    });
  await chrome.storage.local.set({
    activeTarget: enabled === false ? null : target,
    routingAvailable: enabled !== false && Boolean(target),
  });
  return target;
}

async function bundledData() {
  const response = await fetch(chrome.runtime.getURL("fallback-mirrors.json"));
  return response.json();
}

async function loadCachedOrBundled() {
  const stored = await chrome.storage.local.get("data");
  if (stored.data) return stored.data;
  const data = await bundledData();
  await chrome.storage.local.set({ data, dataSource: "内置数据" });
  return data;
}

async function refresh(force = false) {
  const cached = await chrome.storage.local.get(["data", "fetchedAt"]);
  if (!force && cached.data && cached.fetchedAt && Date.now() - cached.fetchedAt < REFRESH_TTL) {
    await applyNetworkRules(cached.data);
    return cached.data;
  }
  let lastError = "无法获取镜像数据";
  for (const url of DATA_URLS) {
    try {
      const response = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!data || !Array.isArray(data.china) || !Array.isArray(data.flow1) || !Array.isArray(data.flow2))
        throw new Error("镜像 JSON 格式无效");
      await chrome.storage.local.set({
        data,
        dataSource: url.includes("g.blfrp.cn") ? "加速线路" : "GitHub Raw",
        lastError: null,
        fetchedAt: Date.now(),
      });
      await chrome.storage.session.set({ tabRoutes: {} });
      await applyNetworkRules(data);
      return data;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  await chrome.storage.local.set({ lastError });
  await applyNetworkRules(cached.data || (await loadCachedOrBundled()));
  return cached.data || null;
}

async function bootstrap() {
  const { enabled } = await chrome.storage.local.get("enabled");
  const data = await loadCachedOrBundled();
  await applyNetworkRules(data);
  refresh(false);
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.remove(["data", "fetchedAt", "activeTarget", "manualTarget"]);
  await chrome.storage.session.set({ tabRoutes: {} });
  await chrome.storage.local.set({ enabled: true });
  chrome.alarms.create("refresh-mirrors", { periodInMinutes: 30 });
  await bootstrap();
});
chrome.runtime.onStartup.addListener(bootstrap);
chrome.alarms.onAlarm.addListener((alarm) => alarm.name === "refresh-mirrors" && refresh(true));

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.type === "refresh") await refresh(true);
    if (message.type === "setEnabled") {
      await chrome.storage.local.set({ enabled: message.enabled });
      await applyNetworkRules(await loadCachedOrBundled());
    }
    if (message.type === "selectTarget") {
      if (message.target) await chrome.storage.local.set({ manualTarget: message.target });
      else await chrome.storage.local.remove("manualTarget");
      await chrome.storage.session.set({ tabRoutes: {} });
      await applyNetworkRules(await loadCachedOrBundled());
    }
    sendResponse(
      await chrome.storage.local.get([
        "data",
        "enabled",
        "activeTarget",
        "manualTarget",
        "dataSource",
        "lastError",
        "fetchedAt",
        "routingAvailable",
      ])
    );
  })();
  return true;
});

bootstrap();
