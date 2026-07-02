const CONTEXT_MENU_ID = "codex-action-board-open-selection";

function createContextMenu() {
  chrome.contextMenus.remove(CONTEXT_MENU_ID, () => {
    void chrome.runtime.lastError;
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: "إرسال التحديد إلى لوحة الإجراءات",
      contexts: ["selection"],
      documentUrlPatterns: [
        "https://chatgpt.com/*",
        "https://*.chatgpt.com/*"
      ]
    });
  });
}

chrome.runtime.onInstalled.addListener(createContextMenu);
chrome.runtime.onStartup?.addListener(createContextMenu);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "codex-action-board:open-context" }, () => {
    void chrome.runtime.lastError;
  });
});
