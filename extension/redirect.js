(async () => {
  const response = await chrome.runtime.sendMessage({ type: "resolveRedirect", url: location.href });
  if (response?.url && response.url !== location.href) location.replace(response.url);
})();
