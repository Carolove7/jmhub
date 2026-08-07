// ==UserScript==
// @name         JMHub 镜像自动跳转
// @namespace    https://github.com/Carolove7/jmhub
// @version      1.1.0
// @description  自动获取最新镜像地址并跳转
// @author       Carolove7
// @homepageURL  https://github.com/Carolove7/jmhub
// @supportURL   https://github.com/Carolove7/jmhub/issues
// @icon         https://jmcomicmi.net/favicon.ico
// @updateURL    https://g.blfrp.cn/https://raw.githubusercontent.com/Carolove7/jmhub/main/jmhub.user.js
// @downloadURL  https://g.blfrp.cn/https://raw.githubusercontent.com/Carolove7/jmhub/main/jmhub.user.js
// @match        https://18comic.vip/*
// @match        https://18comic.ink/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      g.blfrp.cn
// @connect      raw.githubusercontent.com
// @run-at       document-start
// ==/UserScript==

(() => {
  "use strict";

  // GitHub 加速站：g.blfrp.cn/原始 GitHub URL
  const MIRROR_DATA_URL =
    "https://g.blfrp.cn/https://raw.githubusercontent.com/Carolove7/jmhub/main/data/mirror.json";

  const DIRECT_DATA_URL =
    "https://raw.githubusercontent.com/Carolove7/jmhub/main/data/mirror.json";

  const CACHE_KEY = "jmhub_mirror_cache";
  const CACHE_TTL = 6 * 60 * 60 * 1000;
  const REQUEST_TIMEOUT = 8000;

  function readCache() {
    try {
      const cache = GM_getValue(CACHE_KEY, null);
      if (!cache || !cache.data) return null;
      if (Date.now() - cache.time > CACHE_TTL) return null;
      return cache.data;
    } catch {
      return null;
    }
  }

  function writeCache(data) {
    try {
      GM_setValue(CACHE_KEY, {
        time: Date.now(),
        data
      });
    } catch {}
  }

  function request(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: `${url}?t=${Date.now()}`,
        timeout: REQUEST_TIMEOUT,
        headers: {
          "Cache-Control": "no-cache"
        },
        onload: (response) => {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`HTTP ${response.status}`));
            return;
          }

          try {
            resolve(JSON.parse(response.responseText));
          } catch (error) {
            reject(error);
          }
        },
        onerror: () => reject(new Error("request failed")),
        ontimeout: () => reject(new Error("request timeout"))
      });
    });
  }

  async function fetchData() {
    // 优先使用加速站；失败时自动回退 GitHub 原站。
    try {
      const data = await request(MIRROR_DATA_URL);
      writeCache(data);
      return data;
    } catch (error) {
      console.warn("[JMHub] 加速站获取失败，尝试 GitHub 原站:", error);
    }

    try {
      const data = await request(DIRECT_DATA_URL);
      writeCache(data);
      return data;
    } catch (error) {
      console.warn("[JMHub] GitHub 原站获取失败:", error);
      return null;
    }
  }

  function normalizeList(value) {
    if (!Array.isArray(value)) return [];

    return value.map((url) => {
      try {
        const u = new URL(url);
        if (!/^https?:$/.test(u.protocol)) return null;
        return u.origin;
      } catch {
        return null;
      }
    }).filter(Boolean);
  }

  function getCandidates(data) {
    return [...new Set([
      ...normalizeList(data.china),
      ...normalizeList(data.flow1),
      ...normalizeList(data.flow2)
    ])];
  }

  function buildTarget(origin) {
    const target = new URL(origin);
    target.pathname = location.pathname;
    target.search = location.search;
    target.hash = location.hash;
    return target.href;
  }

  async function main() {
    // 优先使用缓存，避免每次打开页面都访问 GitHub。
    let data = readCache();

    if (!data) {
      data = await fetchData();
    }

    if (!data) return;

    const candidates = getCandidates(data);
    if (!candidates.length) {
      console.warn("[JMHub] 没有可用镜像地址。");
      return;
    }

    const currentHost = location.hostname;

    const target = candidates.find((origin) => {
      try {
        return new URL(origin).hostname !== currentHost;
      } catch {
        return false;
      }
    });

    if (!target) return;

    console.log("[JMHub] 跳转到:", target);
    location.replace(buildTarget(target));
  }

  main();
})();
