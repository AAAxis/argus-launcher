chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel) {
    chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true}).catch(() => {});
  }
});

chrome.runtime.onStartup?.addListener(() => {
  if (chrome.sidePanel) {
    chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true}).catch(() => {});
  }
});
