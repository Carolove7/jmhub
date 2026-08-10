const DATA_URLS = [
  "https://g.blfrp.cn/https://raw.githubusercontent.com/Carolove7/jmhub/main/data/mirror.json",
  "https://raw.githubusercontent.com/Carolove7/jmhub/main/data/mirror.json",
];
const RULE_IDS = [1001, 1002];
const SOURCE_HOSTS = ["18comic.vip", "18comic.ink"];

function candidateOrigins(data) {
  const values = [...(data?.china || []), ...(data?.flow1 || []), ...(data?.flow2 || [])];
  const seen = new Set();
  return values.flatMap((value) => {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || SOURCE_HOSTS.includes(url.hostname) || seen.has(url.origin)) return [];
      seen.add(url.origin);
      return [url.origin];
    } catch {
      return [];
    }
  });
}

async function selectedTarget(data) {
  const { manualTarget } = await chrome.storage.local.get("manualTarget");
  const choices = candidateOrigins(data);
  return manualTarget && choices.includes(manualTarget) ? manualTarget : choices[0] || null;
}

async function installRedirectRules(data) {
  const { enabled } = await chrome.storage.local.get("enabled");
  const target = enabled === false ? null : await selectedTarget(data);
  const addRules = target
    ? SOURCE_HOSTS.map((host, index) => ({
        id: RULE_IDS[index],
        priority: 100,
        action: { type: "redirect", redirect: { regexSubstitution: `${target}\\1` } },
        condition: {
          regexFilter: `^https?://${host.replaceAll(".", "\\.")}(/.*)?$`,
          resourceTypes: ["main_frame"],
        },
      }))
    : [];
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: RULE_IDS, addRules });
  await chrome.storage.local.set({ activeTarget: target });
  return target;
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

async function refresh() {
  let lastError = "无法获取镜像数据";
  for (const url of DATA_URLS) {
    try {
      const response = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!candidateOrigins(data).length) throw new Error("数据中没有有效镜像");
      await chrome.storage.local.set({ data, dataSource: url.includes("g.blfrp.cn") ? "加速线路" : "GitHub Raw", lastError: null, fetchedAt: Date.now() });
      await installRedirectRules(data);
      return data;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  await chrome.storage.local.set({ lastError });
  return null;
}

async function bootstrap() {
  const data = await ensureData();
  await installRedirectRules(data);
  refresh();
}

chrome.runtime.onInstalled.addListener(async () => {
  const { enabled } = await chrome.storage.local.get("enabled");
  if (enabled === undefined) await chrome.storage.local.set({ enabled: true });
  chrome.alarms.create("refresh-mirrors", { periodInMinutes: 30 });
  await bootstrap();
});
chrome.runtime.onStartup.addListener(bootstrap);
chrome.alarms.onAlarm.addListener((alarm) => alarm.name === "refresh-mirrors" && refresh());
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.type === "refresh") await refresh();
    if (message.type === "setEnabled") {
      await chrome.storage.local.set({ enabled: message.enabled });
      await installRedirectRules(await ensureData());
    }
    if (message.type === "selectTarget") {
      if (message.target) await chrome.storage.local.set({ manualTarget: message.target });
      else await chrome.storage.local.remove("manualTarget");
      await installRedirectRules(await ensureData());
    }
    const state = await chrome.storage.local.get(["data", "enabled", "activeTarget", "manualTarget", "dataSource", "lastError", "fetchedAt"]);
    sendResponse(state);
  })();
  return true;
});

bootstrap();
