document.getElementById("retry").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "refresh" });
  location.href = "https://18comic.vip/";
});
