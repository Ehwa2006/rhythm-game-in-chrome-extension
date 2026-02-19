// ====== Background Service Worker ======

// tabCapture streamId 획득
async function getTabStreamId(tabId) {
  try {
    const stream = await chrome.tabCapture.capture({
      audio: true,
      video: false
    });
    
    if (stream) {
      console.log("[BG] ✅ tabCapture stream obtained");
      // streamId 추출 (stream.id가 있으면 사용)
      return stream.id || null;
    }
  } catch (err) {
    console.log("[BG] tabCapture not available or blocked:", err.message);
  }
  return null;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("[BG] ✅ Message received:", request.type, "from tab:", sender?.tab?.id);
  
  if (request.type === "START_GAME") {
    const tabId = request.tabId;
    console.log("[BG] START_GAME - tabId:", tabId);
    
    if (!tabId) {
      console.error("[BG] ❌ No tabId!");
      sendResponse({ success: false, error: "no_tab_id" });
      return;
    }

    // 0) tabCapture streamId 획득 시도
    console.log("[BG] Attempting to get tabCapture streamId...");
    getTabStreamId(tabId).then((streamId) => {
      console.log("[BG] streamId result:", streamId);

      // 1) content.js 먼저 로드 (isolated world)
      console.log("[BG] Injecting content.js...");
      chrome.scripting.executeScript(
        { target: { tabId }, files: ["content.js"], world: "ISOLATED" },
        () => {
          console.log("[BG] ✅ content.js injected");
          
          // 2) overlay.js 로드 (MAIN world)
          console.log("[BG] Injecting overlay.js...");
          chrome.scripting.executeScript(
            { target: { tabId }, files: ["overlay.js"], world: "MAIN" },
            () => {
              console.log("[BG] ✅ overlay.js injected");
              
              if (chrome.runtime.lastError) {
                console.error("[BG] ❌ Script injection failed:", chrome.runtime.lastError);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
                return;
              }
              
              // 3) 약간의 지연 후 START_AUDIO 메시지 전송 (streamId 포함)
              setTimeout(() => {
                console.log("[BG] Sending START_AUDIO to content.js with streamId:", streamId);
                chrome.tabs.sendMessage(tabId, { type: "START_AUDIO", streamId: streamId }, (response) => {
                  if (chrome.runtime.lastError) {
                    console.warn("[BG] ⚠️ sendMessage error:", chrome.runtime.lastError.message);
                  } else {
                    console.log("[BG] ✅ sendMessage success");
                  }
                });
              }, 100);  // 100ms 지연
              
              sendResponse({ success: true });
            }
          );
        }
      );
    });
    return true;
  }
});

// ====== 아이콘 클릭 ======
chrome.action.onClicked.addListener((tab) => {
  console.log("[BG] Icon clicked on tab:", tab.id);
  
  chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_GAME" }, (response) => {
    if (chrome.runtime.lastError) {
      console.log("[BG] TOGGLE_GAME - content.js not ready, injecting scripts");
      
      // content.js 먼저 로드
      chrome.scripting.executeScript(
        { target: { tabId: tab.id }, files: ["content.js"], world: "ISOLATED" },
        () => {
          // overlay.js 로드
          chrome.scripting.executeScript(
            { target: { tabId: tab.id }, files: ["overlay.js"], world: "MAIN" },
            () => {
              console.log("[BG] Scripts injected, sending START_AUDIO");
              setTimeout(() => {
                chrome.tabs.sendMessage(tab.id, { type: "START_AUDIO", streamId: null }, () => {});
              }, 100);
            }
          );
        }
      );
    } else {
      console.log("[BG] TOGGLE_GAME sent successfully");
    }
  });
});
