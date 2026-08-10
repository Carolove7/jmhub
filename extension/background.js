const DATA_URLS = [
  "https://g.blfrp.cn/https://raw.githubusercontent.com/Carolove7/jmhub/main/data/mirror.json",
  "https://raw.githubusercontent.com/Carolove7/jmhub/main/data/mirror.json",
];
const RULE_IDS = [1001, 1002, 1003, 1004];
const SOURCE_HOSTS = ["18comic.vip", "18comic.ink", "jmcomic-zzz.one", "jmcomic-zzz.org"];
const REFRESH_TTL = 30 * 60 * 1000;

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
  const { badTargets = [] } = await chrome.storage.session.get("badTargets");
  const choices = candidateOrigins(data).filter((target) => !badTargets.includes(target));
  return manualTarget && choices.includes(manualTarget) ? manualTarget : choices[0] || null;
}

async function installRedirectRules(data, forcedTarget = undefined) {
  const { enabled } = await chrome.storage.local.get("enabled");
  const target = enabled === false ? null : forcedTarget === undefined ? await selectedTarget(data) : forcedTarget;
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const targetHost = target ? new URL(target).hostname : null;
  const rulesCurrent = targetHost
    ? existing.length === SOURCE_HOSTS.length && existing.every((rule) => rule.action.redirect?.transform?.host === targetHost)
    : existing.length === 0;
  if (rulesCurrent) {
    await chrome.storage.local.set({ activeTarget: target });
    return target;
  }
  const addRules = target
    ? SOURCE_HOSTS.map((host, index) => ({
        id: RULE_IDS[0] + index,
        priority: 100,
        action: { type: "redirect", redirect: { transform: { scheme: "https", host: new URL(target).hostname } } },
        condition: {
          urlFilter: `||${host}^`,
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

async function refresh(force = false) {
  if (!force) {
    const cached = await chrome.storage.local.get(["data", "fetchedAt"]);
    if (cached.data && cached.fetchedAt && Date.now() - cached.fetchedAt < REFRESH_TTL) return cached.data;
  }
  let lastError = "无法获取镜像数据";
  for (const url of DATA_URLS) {
    try {
      const response = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!candidateOrigins(data).length) throw new Error("数据中没有有效镜像");
      const previous = await chrome.storage.local.get("data");
      if (previous.data?.updated_at !== data.updated_at) await chrome.storage.session.set({ badTargets: [] });
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
  refresh(false);
}

chrome.runtime.onInstalled.addListener(async () => {
  const { enabled } = await chrome.storage.local.get("enabled");
  if (enabled === undefined) await chrome.storage.local.set({ enabled: true });
  chrome.alarms.create("refresh-mirrors", { periodInMinutes: 30 });
  await bootstrap();
});
chrome.runtime.onStartup.addListener(bootstrap);
chrome.alarms.onAlarm.addListener((alarm) => alarm.name === "refresh-mirrors" && refresh(true));
chrome.webNavigation.onErrorOccurred.addListener(async (details) => {
  if (details.frameId !== 0 || !details.error.includes("ERR_TOO_MANY_REDIRECTS")) return;
  const data = await ensureData();
  const { activeTarget } = await chrome.storage.local.get("activeTarget");
  const session = await chrome.storage.session.get("badTargets");
  const badTargets = new Set(session.badTargets || []);
  if (activeTarget) badTargets.add(activeTarget);
  await chrome.storage.session.set({ badTargets: [...badTargets] });
  const next = candidateOrigins(data).find((target) => !badTargets.has(target));
  if (!next) {
    await installRedirectRules(data, null);
    await chrome.storage.local.set({ lastError: "所有镜像均发生重定向循环，已暂停自动跳转" });
    return;
  }
  await installRedirectRules(data, next);
  const failed = new URL(details.url);
  const retryUrl = new URL(failed.pathname + failed.search + failed.hash, next).href;
  await chrome.tabs.update(details.tabId, { url: retryUrl });
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.type === "refresh") await refresh(true);
    if (message.type === "setEnabled") {
      await chrome.storage.local.set({ enabled: message.enabled });
      await installRedirectRules(await ensureData());
    }
    if (message.type === "selectTarget") {
      if (message.target) {
        await chrome.storage.local.set({ manualTarget: message.target });
        const session = await chrome.storage.session.get("badTargets");
        await chrome.storage.session.set({ badTargets: (session.badTargets || []).filter((target) => target !== message.target) });
      } else {
        await chrome.storage.local.remove("manualTarget");
        await chrome.storage.session.set({ badTargets: [] });
      }
      await installRedirectRules(await ensureData());
    }
    const state = await chrome.storage.local.get(["data", "enabled", "activeTarget", "manualTarget", "dataSource", "lastError", "fetchedAt"]);
    sendResponse(state);
  })();
  return true;
});

bootstrap();
