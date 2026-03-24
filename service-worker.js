async function notifyPanelOfPageChange(tabId, changeInfo, tab) {
  try {
    await chrome.runtime.sendMessage({
      type: "PAGE_CHANGED",
      tabId,
      changeInfo,
      url: tab?.url || ""
    });
  } catch (error) {
    // Ignore if panel is not open yet
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: true,
  });
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await notifyPanelOfPageChange(tabId, { status: "activated" }, tab);
  } catch (error) {
    console.error("onActivated error:", error);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Refresh when URL changes or when page finishes loading
  if (changeInfo.url || changeInfo.status === "complete") {
    await notifyPanelOfPageChange(tabId, changeInfo, tab);
  }
});