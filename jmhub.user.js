// ==UserScript==
// @name         JMHub 镜像自动跳转
// @namespace    https://github.com/Carolove7/jmhub
// @version      1.0.0
// @description  从 GitHub 获取最新镜像地址并自动跳转
// @author       Carolove7
// @homepageURL  https://github.com/Carolove7/jmhub
// @supportURL   https://github.com/Carolove7/jmhub/issues
// @updateURL    https://raw.githubusercontent.com/Carolove7/jmhub/main/jmhub.user.js
// @downloadURL  https://raw.githubusercontent.com/Carolove7/jmhub/main/jmhub.user.js
// @match        https://18comic.vip/*
// @match        https://18comic.ink/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      raw.githubusercontent.com
// @run-at       document-start
// ==/UserScript==

(() => {
  "use strict";

  const API_URL = "https://raw.githubusercontent.com/Carolove7/jmhub/main/data/mirror.json";
  const CACHE_KEY = "jmhub_mirror_cache";
  const CACHE_TTL = 6 * 60 * 60 * 1000;

  function readCache() {
    try {
      const cache = GM_getValue(CACHE_KEY, null);
      if (!cache || !cache.data || Date.now() - cache.time > CACHE_TTL) return null;
      return cache.data;
    } catch {
      return null;
    }
  }

  function writeCache(data) {
    try {
      GM_setValue(CACHE_KEY, { time: Date.now(), data });
    } catch {}
  }

  function fetchData() {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: `${API_URL}?t=${Date.now()}`,
        timeout: 8000,
        onload: (response) => {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`HTTP ${response.status}`));
            return;
          }
          try {
            const data = JSON.parse(response.responseText);
            writeCache(data);
            resolve(data);
          } catch (error) {
            reject(error);
          }
        },
        onerror: () => reject(new Error("Failed to fetch mirror data")),
        ontimeout: () => reject(new Error("Mirror data request timed out"))
      });
    });
  }

  function normalizeList(value) {
    if (!Array.isArray(value)) return [];
    return value.map((url) => {
      try {
        const u = new URL(url);
        return /^https?:$/.test(u.protocol) ? u.origin : null;
      } catch {
        return null;
      }
    }).filter(Boolean);
  }

  function getCandidates(data) {
    // Prefer the mainland address, then fallback 1 and fallback 2.
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
    let data = readCache();

    if (!data) {
      try {
        data = await fetchData();
      } catch (error) {
        console.warn("[JMHub] Unable to get mirror data:", error);
        return;
      }
    }

    const candidates = getCandidates(data);
    if (!candidates.length) {
      console.warn("[JMHub] No mirror addresses available.");
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

    console.log("[JMHub] Redirecting to:", target);
    location.replace(buildTarget(target));
  }

  main();
})();
