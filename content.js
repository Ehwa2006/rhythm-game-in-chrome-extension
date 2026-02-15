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

  const BEAT_THRESHOLD = 130;
  const BEAT_COOLDOWN = 0.22; // seconds

  // ── background로부터 메시지 수신 ──
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "TOGGLE_GAME") {
      window.postMessage({ type: "RHYTHM_TOGGLE" }, "*");
      sendResponse({ success: true });
    }
    if (request.type === "START_AUDIO") {
      startAudio(request.streamId);
      sendResponse({ success: true });
    }
  });

  function startAudio(streamId) {
    if (!streamId) {
      notifyStatus("🎮 자동 스폰 모드");
      return;
    }

    // isolated world에서 chromeMediaSource: "tab" 사용 가능
    navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId
        }
      },
      video: false
    }).then((stream) => {
      audioCtx = new AudioContext();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.75;
      dataArray = new Uint8Array(analyser.frequencyBinCount);

      const src = audioCtx.createMediaStreamSource(stream);
      src.connect(analyser);
      // destination에 연결 안 함 → Spotify 소리 출력에 영향 없음

      notifyStatus("🎵 탭 오디오 연결됨 ✅");
      console.log("[RhythmContent] tabCapture connected");

      beatDetecting = true;
      detectBeat();

    }).catch((err) => {
      console.warn("[RhythmContent] tabCapture failed:", err.message);
      notifyStatus("🎤 마이크 연결 시도...");
      tryMicrophone();
    });
  }

  function tryMicrophone() {
    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then((stream) => {
        audioCtx = new AudioContext();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.75;
        dataArray = new Uint8Array(analyser.frequencyBinCount);

        const src = audioCtx.createMediaStreamSource(stream);
        src.connect(analyser);

        notifyStatus("🎤 마이크 연결됨");
        beatDetecting = true;
        detectBeat();
      })
      .catch(() => {
        notifyStatus("🎮 자동 스폰 모드");
      });
  }

  function detectBeat() {
    if (!beatDetecting || !analyser) return;

    analyser.getByteFrequencyData(dataArray);

    // 저음역 에너지
    let energy = 0;
    const bins = Math.min(15, dataArray.length);
    for (let i = 0; i < bins; i++) energy += dataArray[i];
    energy /= bins;

    // 중음역
    let mid = 0;
    const mStart = Math.floor(dataArray.length * 0.1);
    const mEnd   = Math.floor(dataArray.length * 0.3);
    for (let i = mStart; i < mEnd; i++) mid += dataArray[i];
    mid /= (mEnd - mStart);

    const combined = energy * 0.7 + mid * 0.3;
    const now = audioCtx.currentTime;

    if (combined > BEAT_THRESHOLD && now - lastBeatTime > BEAT_COOLDOWN) {
      lastBeatTime = now;
      // MAIN world의 overlay에 비트 이벤트 전송
      window.postMessage({ type: "RHYTHM_BEAT" }, "*");
    }

    requestAnimationFrame(detectBeat);
  }

  function notifyStatus(msg) {
    window.postMessage({ type: "RHYTHM_STATUS", msg }, "*");
  }
}
