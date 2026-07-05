const CONTEXT_MENU_ID = "codex-action-board-open-selection";

const MENU_TITLES = {
  ar: "إرسال التحديد إلى لوحة الإجراءات",
  en: "Send selection to Action Board"
};

async function createContextMenu(language) {
  const stored = language || (await chrome.storage.local.get("actionBoardLanguage")).actionBoardLanguage || "en";
  chrome.contextMenus.remove(CONTEXT_MENU_ID, () => {
    void chrome.runtime.lastError;
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: MENU_TITLES[stored] || MENU_TITLES.en,
      contexts: ["selection"],
      documentUrlPatterns: [
        "https://chatgpt.com/*",
        "https://*.chatgpt.com/*"
      ]
    });
  });
}

chrome.runtime.onInstalled.addListener(() => createContextMenu());
chrome.runtime.onStartup?.addListener(() => createContextMenu());

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "codex-action-board:set-language") return;
  const language = message.language === "en" ? "en" : "ar";
  chrome.storage.local.set({ actionBoardLanguage: language });
  createContextMenu(language);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "codex-action-board:open-context" }, () => {
    void chrome.runtime.lastError;
  });
});
