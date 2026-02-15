// ====== Content Script (Isolated World) ======
// tabCapture 오디오 캡처 + 비트 감지 → MAIN world로 이벤트 전송

if (window.__RHYTHM_CONTENT_LOADED__) {
  // 이미 로드됨: 토글 요청
  window.postMessage({ type: "RHYTHM_TOGGLE" }, "*");
} else {
  window.__RHYTHM_CONTENT_LOADED__ = true;

  let audioCtx = null;
  let analyser = null;
  let dataArray = null;
  let beatDetecting = false;
  let lastBeatTime = 0;

  // 🔴 tabCapture는 isolated world에서 작동 불가능 (Chrome 보안 정책)
  // → 자동 비트 모드만 제공

  // ── 비트 감지 파라미터 (Spotify 특화 - 고감도 모드) ──
  const BEAT_THRESHOLD = 75;         // 더 민감한 감지 (낮을수록 민감)
  const BEAT_COOLDOWN = 0.15;        // 더 빠른 연속 감지 가능
  const SPOTIFY_MODE = true;         // Spotify 최적화 모드

  // ── background로부터 메시지 수신 ──
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("[Content] ✅ Received message:", request.type, "streamId:", request.streamId);
    
    if (request.type === "TOGGLE_GAME") {
      window.postMessage({ type: "RHYTHM_TOGGLE" }, "*");
      sendResponse({ success: true });
    }
    // START_AUDIO 요청: streamId를 MAIN world (overlay.js)로 전달
    if (request.type === "START_AUDIO") {
      console.log("[Content] START_AUDIO received - forwarding to overlay.js...");
      window.postMessage({ 
        type: "RHYTHM_STREAM_ID", 
        streamId: request.streamId 
      }, "*");
      console.log("[Content] ✅ Posted message to overlay.js");
      sendResponse({ success: true });
    }
  });

  // 게임 초기화: streamId 대기 상태
  window.postMessage({ type: "RHYTHM_STATUS", msg: "🎮 오버레이 준비 완료" }, "*");
  console.log("[Content] ✅ Loaded - ready to receive streamId from background");
}
