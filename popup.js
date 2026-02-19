const btn       = document.getElementById("start");
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

    // chrome:// 등 지원 불가 페이지 차단
    if (
      !tab.url ||
      tab.url.startsWith("chrome://") ||
      tab.url.startsWith("chrome-extension://") ||
      tab.url.startsWith("about:")
    ) {
      setStatus("⚠️ YouTube나 Spotify 탭에서 실행하세요.", "#ffaa00");
      btn.disabled = false;
      return;
    }

    // ── 이미 게임이 로드되어 있으면 resetRhythmGame() 시도 ──
    chrome.scripting.executeScript(
      {
        target: { tabId: tab.id },
        func: () => {
          if (typeof window.resetRhythmGame === "function") {
            window.resetRhythmGame();
            return "reset";
          }
          return "new";
        },
        world: "MAIN",
      },
      (results) => {
        const result = results && results[0] && results[0].result;

        if (result === "reset") {
          setStatus("🔄 게임 재시작!", "#00ff88");
          btn.disabled = false;
          return;
        }

        // ── 처음 실행: background에 START_GAME 메시지 ──
        chrome.runtime.sendMessage(
          { type: "START_GAME", tabId: tab.id },
          (response) => {
            btn.disabled = false;

            if (chrome.runtime.lastError) {
              console.error("BG error:", chrome.runtime.lastError.message);
              setStatus("❌ 오류: " + chrome.runtime.lastError.message, "#ff4444");
              return;
            }

            if (response && response.success) {
              setStatus("✅ 게임 실행 중!", "#00ff88");
            } else {
              const err = response && response.error ? response.error : "알 수 없는 오류";
              setStatus("❌ 실패: " + err, "#ff4444");
            }
          }
        );
      }
    );
  } catch (err) {
    console.error("Popup error:", err);
    setStatus("❌ " + err.message, "#ff4444");
    btn.disabled = false;
  }
});
