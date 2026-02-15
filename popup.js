const btn = document.getElementById("start");
const statusMsg = document.getElementById("status-msg");

function setStatus(msg, color) {
  statusMsg.textContent = msg;
  statusMsg.style.color = color || "#7ec8e3";
}

btn.addEventListener("click", async () => {
  btn.disabled = true;
  setStatus("게임을 시작하는 중...");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.id) {
      setStatus("❌ 활성 탭을 찾을 수 없습니다.", "#ff4444");
      btn.disabled = false;
      return;
    }

    // 지원하지 않는 페이지 확인 (chrome://, extension:// 등)
    if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://") || tab.url.startsWith("about:")) {
      setStatus("⚠️ 이 페이지에서는 실행할 수 없습니다.\nYouTube나 Spotify 탭에서 실행하세요.", "#ffaa00");
      btn.disabled = false;
      return;
    }

    chrome.runtime.sendMessage(
      { type: "START_GAME", tabId: tab.id },
      (response) => {
        btn.disabled = false;

        if (chrome.runtime.lastError) {
          console.error("Background error:", chrome.runtime.lastError.message);
          setStatus("❌ 오류: " + chrome.runtime.lastError.message, "#ff4444");
          return;
        }

        if (response && response.success) {
          setStatus("✅ 게임이 실행됩니다!", "#00ff88");
          // 팝업 유지 (닫지 않음)
        } else {
          const errMsg = response && response.error ? response.error : "알 수 없는 오류";
          setStatus("❌ 실패: " + errMsg, "#ff4444");
        }
      }
    );
  } catch (err) {
    console.error("Popup error:", err);
    setStatus("❌ " + err.message, "#ff4444");
    btn.disabled = false;
  }
});
