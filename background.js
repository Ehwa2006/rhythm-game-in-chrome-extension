// ====== Background Service Worker ======

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  // ====== START_GAME: 팝업에서 요청 ======
  if (request.type === "START_GAME") {
    const tabId = request.tabId;
    if (!tabId) { sendResponse({ success: false, error: "no_tab_id" }); return; }

    // 1) overlay.js 주입 (MAIN world - 렌더링 담당)
    chrome.scripting.executeScript(
      { target: { tabId }, files: ["overlay.js"], world: "MAIN" },
      () => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        // 2) tabCapture streamId 발급 후 content.js로 전달
        chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
          const sid = (!chrome.runtime.lastError && streamId) ? streamId : null;
          if (!sid) console.warn("[BG] tabCapture failed:", chrome.runtime.lastError?.message);

          chrome.tabs.sendMessage(tabId,
            { type: "START_AUDIO", streamId: sid },
            () => { /* content.js가 처리 */ }
          );
          sendResponse({ success: true });
        });
      }
    );
    return true;
  }

  // ====== INJECT_OVERLAY: content.js에서 직접 요청할 때 ======
  if (request.type === "INJECT_OVERLAY") {
    const tabId = sender?.tab?.id;
    if (!tabId) { sendResponse({ success: false, error: "no_tab_id" }); return; }

    chrome.scripting.executeScript(
      { target: { tabId }, files: ["overlay.js"], world: "MAIN" },
      () => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
          const sid = (!chrome.runtime.lastError && streamId) ? streamId : null;
          chrome.tabs.sendMessage(tabId, { type: "START_AUDIO", streamId: sid }, () => {});
          sendResponse({ success: true });
        });
      }
    );
    return true;
  }
});

// ====== 아이콘 클릭 ======
chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_GAME" }, (response) => {
    if (chrome.runtime.lastError) {
      // content.js 없음 → 직접 실행
      chrome.scripting.executeScript(
        { target: { tabId: tab.id }, files: ["overlay.js"], world: "MAIN" },
        () => {
          chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (streamId) => {
            const sid = (!chrome.runtime.lastError && streamId) ? streamId : null;
            chrome.tabs.sendMessage(tab.id, { type: "START_AUDIO", streamId: sid }, () => {});
          });
        }
      );
    }
  });
});
