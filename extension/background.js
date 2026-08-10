const DATA_URLS = [
  "https://g.blfrp.cn/https://raw.githubusercontent.com/Carolove7/jmhub/main/data/mirror.json",
  "https://raw.githubusercontent.com/Carolove7/jmhub/main/data/mirror.json",
];
const REFRESH_TTL = 30 * 60 * 1000;
const ROUTE_TTL = 2 * 60 * 1000;
const LEGACY_RULE_IDS = [1001, 1002, 1003, 1004];

async function clearLegacyRules() {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  const ids = rules.filter((rule) => LEGACY_RULE_IDS.includes(rule.id)).map((rule) => rule.id);
  if (ids.length) await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: ids });
}

function candidateOrigins(data) {
  const values = [...(data?.china || []), ...(data?.flow1 || []), ...(data?.flow2 || [])];
  return [...new Set(values.flatMap((value) => {
    try { const url = new URL(value); return url.protocol === "https:" ? [url.origin] : []; }
    catch { return []; }
  }))];
}

async function bundledData() {
  const response = await fetch(chrome.runtime.getURL("fallback-mirrors.json"));
  return response.json();
}

async function ensureData() {
  const store = await chrome.storage.local.get("data");
  if (candidateOrigins(store.data).length) return store.data;
  const data = await bundledData();
  await chrome.storage.local.set({ data, dataSource: "内置数据" });
  return data;
}

async function refresh(force = false) {
  const cached = await chrome.storage.local.get(["data", "fetchedAt"]);
  if (!force && cached.data && cached.fetchedAt && Date.now() - cached.fetchedAt < REFRESH_TTL) return cached.data;
  let lastError = "无法获取镜像数据";
  for (const url of DATA_URLS) {
    try {
      const response = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!candidateOrigins(data).length) throw new Error("数据中没有有效镜像");
      if (cached.data?.updated_at !== data.updated_at) await chrome.storage.session.set({ tabRoutes: {} });
      await chrome.storage.local.set({ data, dataSource: url.includes("g.blfrp.cn") ? "加速线路" : "GitHub Raw", lastError: null, fetchedAt: Date.now() });
      return data;
    } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
  }
  await chrome.storage.local.set({ lastError });
  return cached.data || null;
}

async function resolveRedirect(tabId, originalUrl) {
  const store = await chrome.storage.local.get(["enabled", "manualTarget"]);
  if (store.enabled === false) return null;
  const data = await ensureData();
  const choices = candidateOrigins(data);
  const session = await chrome.storage.session.get("tabRoutes");
  const tabRoutes = session.tabRoutes || {};
  let route = tabRoutes[tabId] || { attempted: [], lastTarget: null, updatedAt: 0 };
  if (Date.now() - route.updatedAt > ROUTE_TTL) route = { attempted: [], lastTarget: null, updatedAt: 0 };
  if (route.lastTarget && !route.attempted.includes(route.lastTarget)) route.attempted.push(route.lastTarget);
  const preferred = store.manualTarget && choices.includes(store.manualTarget) ? store.manualTarget : null;
  const target = [preferred, ...choices].find((item) => item && !route.attempted.includes(item));
  if (!target) {
    delete tabRoutes[tabId];
    await chrome.storage.session.set({ tabRoutes });
    await chrome.storage.local.set({ lastError: "当前中国区镜像均发生回跳，已停止本次自动跳转" });
    return null;
  }
  route = { ...route, lastTarget: target, updatedAt: Date.now() };
  tabRoutes[tabId] = route;
  await chrome.storage.session.set({ tabRoutes });
  await chrome.storage.local.set({ activeTarget: target, lastError: null });
  const source = new URL(originalUrl);
  return new URL(source.pathname + source.search + source.hash, target).href;
}

async function clearCompletedRoute(tabId, url) {
  const data = await ensureData();
  if (!candidateOrigins(data).some((origin) => new URL(origin).hostname === new URL(url).hostname)) return;
  const session = await chrome.storage.session.get("tabRoutes");
  const tabRoutes = session.tabRoutes || {};
  delete tabRoutes[tabId];
  await chrome.storage.session.set({ tabRoutes });
}

chrome.runtime.onInstalled.addListener(async () => {
  await clearLegacyRules();
  const { enabled } = await chrome.storage.local.get("enabled");
  if (enabled === undefined) await chrome.storage.local.set({ enabled: true });
  chrome.alarms.create("refresh-mirrors", { periodInMinutes: 30 });
  await ensureData();
  refresh(false);
});
chrome.runtime.onStartup.addListener(() => refresh(false));
chrome.alarms.onAlarm.addListener((alarm) => alarm.name === "refresh-mirrors" && refresh(true));
chrome.webNavigation.onCompleted.addListener((details) => details.frameId === 0 && clearCompletedRoute(details.tabId, details.url));
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const session = await chrome.storage.session.get("tabRoutes");
  const tabRoutes = session.tabRoutes || {}; delete tabRoutes[tabId];
  await chrome.storage.session.set({ tabRoutes });
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === "resolveRedirect") sendResponse({ url: await resolveRedirect(sender.tab.id, message.url) });
    else {
      if (message.type === "refresh") await refresh(true);
      if (message.type === "setEnabled") await chrome.storage.local.set({ enabled: message.enabled });
      if (message.type === "selectTarget") {
        if (message.target) await chrome.storage.local.set({ manualTarget: message.target });
        else await chrome.storage.local.remove("manualTarget");
        await chrome.storage.session.set({ tabRoutes: {} });
      }
      sendResponse(await chrome.storage.local.get(["data", "enabled", "activeTarget", "manualTarget", "dataSource", "lastError", "fetchedAt"]));
    }
  })();
  return true;
});

clearLegacyRules();
