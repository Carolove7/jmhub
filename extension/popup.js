const $ = (id) => document.getElementById(id);
const origins = (data) => {
  const groups = [["内地", data?.china || []], ["分流 1", data?.flow1 || []], ["分流 2", data?.flow2 || []]];
  return groups.flatMap(([label, urls]) => urls.flatMap((url) => { try { return [{ label, origin: new URL(url).origin }]; } catch { return []; } }));
};
function formatTime(value) { if (!value) return "等待更新"; const date = new Date(value); return Number.isNaN(date.valueOf()) ? value : date.toLocaleString("zh-CN", { hour12: false }); }
function render(state) {
  $("enabled").checked = state.enabled !== false;
  $("target").textContent = state.activeTarget || "自动跳转已关闭";
  $("source").textContent = state.dataSource || "缓存数据";
  $("updated").textContent = formatTime(state.data?.updated_at || state.fetchedAt);
  $("error").hidden = !state.lastError; $("error").textContent = state.lastError || "";
  $("routes").replaceChildren(...origins(state.data).map(({ label, origin }) => {
    const button = document.createElement("button"); button.className = `route${state.activeTarget === origin ? " active" : ""}`;
    button.innerHTML = `<span class="badge"></span><span class="url"></span><span class="check">${state.activeTarget === origin ? "✓" : ""}</span>`;
    button.querySelector(".badge").textContent = label; button.querySelector(".url").textContent = origin;
    button.onclick = async () => render(await chrome.runtime.sendMessage({ type: "selectTarget", target: origin })); return button;
  }));
}
async function load() { render(await chrome.runtime.sendMessage({ type: "state" })); }
$("enabled").onchange = async (event) => render(await chrome.runtime.sendMessage({ type: "setEnabled", enabled: event.target.checked }));
$("auto").onclick = async () => render(await chrome.runtime.sendMessage({ type: "selectTarget", target: null }));
$("refresh").onclick = async () => { $("refresh").disabled = true; $("refresh").textContent = "正在刷新…"; render(await chrome.runtime.sendMessage({ type: "refresh" })); $("refresh").disabled = false; $("refresh").innerHTML = "<span>↻</span> 立即刷新镜像数据"; };
load();
