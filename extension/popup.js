const $ = (id) => document.getElementById(id);

function routeItems(data) {
  const groups = [
    ["内地", data?.china || []],
    ["分流 1", data?.flow1 || []],
    ["分流 2", data?.flow2 || []],
  ];
  return groups.flatMap(([label, urls]) => urls.flatMap((url) => {
    try {
      return [{ label, url, origin: new URL(url).origin, status: data?.checked?.[url] || {} }];
    } catch {
      return [];
    }
  }));
}

function formatTime(value) {
  if (!value) return "等待更新";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function statusText(status) {
  if (status.safe === true) return "可用";
  if (status.redirect_to) return "服务器检测到重定向";
  if (status.status) return `HTTP ${status.status}`;
  return "不可用";
}

function render(state) {
  $("enabled").checked = state.enabled !== false;
  $("target").textContent = state.activeTarget || (state.enabled === false ? "自动跳转已关闭" : "暂无安全中国区镜像");
  $("source").textContent = state.dataSource || "缓存数据";
  $("updated").textContent = formatTime(state.data?.updated_at || state.fetchedAt);
  $("error").hidden = !state.lastError;
  $("error").textContent = state.lastError || "";

  const buttons = routeItems(state.data).map(({ label, origin, status }) => {
    const button = document.createElement("button");
    button.className = `route${state.activeTarget === origin ? " active" : ""}`;
    button.innerHTML = '<span class="badge"></span><span class="url"></span><span class="check"></span>';
    button.querySelector(".badge").textContent = label;
    button.querySelector(".url").textContent = `${origin} · ${statusText(status)}`;
    button.querySelector(".check").textContent = state.activeTarget === origin ? "✓" : "";
    button.addEventListener("click", async () => render(await chrome.runtime.sendMessage({ type: "selectTarget", target: origin })));
    return button;
  });
  $("routes").replaceChildren(...buttons);
}

async function load() {
  render(await chrome.runtime.sendMessage({ type: "state" }));
}

$("enabled").addEventListener("change", async (event) => {
  render(await chrome.runtime.sendMessage({ type: "setEnabled", enabled: event.target.checked }));
});
$("auto").addEventListener("click", async () => {
  render(await chrome.runtime.sendMessage({ type: "selectTarget", target: null }));
});
$("refresh").addEventListener("click", async () => {
  $("refresh").disabled = true;
  $("refresh").textContent = "正在刷新…";
  render(await chrome.runtime.sendMessage({ type: "refresh" }));
  $("refresh").disabled = false;
  $("refresh").innerHTML = "<span>↻</span> 立即刷新镜像数据";
});

load();
