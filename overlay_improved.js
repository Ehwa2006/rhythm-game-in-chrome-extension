// ====== Rhythm Game Overlay (Improved Version) ======
// 개선사항: 메모리 누수 방지, 성능 최적화, 코드 정리

if (window.__RHYTHM_GAME_LOADED__) {
  console.log("[Overlay] Already loaded - toggling");
  if (window.toggleGame) window.toggleGame();
} else {
  window.__RHYTHM_GAME_LOADED__ = true;

  // ===== 상태 변수 =====
  let canvas, ctx, container, uiContainer;
  let animFrameId = null;
  let autoSpawnTimer = 0;
  let keydownHandler = null;
  let visibilityHandler = null;
  let resizeHandler = null;

  // 오디오 캡처 변수
  let audioCtx = null;
  let analyser = null;
  let dataArray = null;
  let beatDetecting = false;
  let lastBeatTime = 0;

  // 비트 감지 파라미터
  const BEAT_THRESHOLD = 75;
  const BEAT_COOLDOWN = 0.15;

  let notes = [];
  let effects = [];
  let beatPatternIndex = 0;
  const AUTO_SPAWN_PATTERN = [true, true, true, false, true, false, true, true];

  const gameState = {
    score: 0,
    combo: 0,
    maxCombo: 0,
    active: true,
    audioReady: false,
  };

  // 설정
  const W = 420;
  let H = window.innerHeight;

  const LANE_COUNT = 4;
  const LANE_COLORS = ["#00e5ff", "#ff4081", "#76ff03", "#ffea00"];
  const LANE_KEYS = ["d", "f", "j", "k"];
  const HIT_Y_RATIO = 0.82;
  const NOTE_W = 80;
  const NOTE_H = 28;
  const NOTE_SPEED = 5;
  const HIT_PERFECT = 24;
  const HIT_GOOD = 50;
  const AUTO_SPAWN_INTERVAL = 30;

  function getLaneX(laneIndex) {
    const padding = (W - LANE_COUNT * NOTE_W) / 2;
    return padding + laneIndex * NOTE_W + NOTE_W / 2;
  }

  function getHitY() {
    return Math.floor(H * HIT_Y_RATIO);
  }

  // ===== DOM 생성 =====
  function createOverlay() {
    H = window.innerHeight;

    const existing = document.getElementById("rhythm-overlay-container");
    if (existing) existing.remove();

    container = document.createElement("div");
    container.id = "rhythm-overlay-container";
    container.style.cssText = `
      position: fixed !important; top: 0 !important; right: 0 !important;
      width: ${W}px !important; height: 100vh !important;
      z-index: 2147483647 !important; pointer-events: none !important;
      overflow: hidden !important;
    `;

    canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    canvas.style.cssText = `
      position: absolute !important; top: 0 !important; left: 0 !important;
      width: ${W}px !important; height: ${H}px !important;
      z-index: 2147483647 !important; display: block !important;
    `;

    ctx = canvas.getContext("2d", { willReadFrequently: false });
    container.appendChild(canvas);

    // UI 레이어
    uiContainer = document.createElement("div");
    uiContainer.id = "rhythm-game-ui";
    uiContainer.style.cssText = `
      position: absolute !important; top: 10px !important; left: 10px !important;
      color: white !important; font-family: 'Segoe UI', Arial !important;
      font-size: 16px !important; z-index: 2147483647 !important;
      text-shadow: 1px 1px 4px rgba(0,0,0,0.9) !important;
      pointer-events: none !important; line-height: 1.8 !important;
      width: 150px !important;
    `;

    const scoreDiv = document.createElement("div");
    scoreDiv.id = "rg-score";
    scoreDiv.textContent = "Score: 0";
    uiContainer.appendChild(scoreDiv);

    const comboDiv = document.createElement("div");
    comboDiv.id = "rg-combo";
    comboDiv.textContent = "Combo: 0";
    uiContainer.appendChild(comboDiv);

    const statusDiv = document.createElement("div");
    statusDiv.id = "rg-status";
    statusDiv.style.cssText = "font-size:11px;opacity:0.7;margin-top:4px;";
    statusDiv.textContent = "⏸️ 대기 중 (음악 없음)";
    uiContainer.appendChild(statusDiv);
    container.appendChild(uiContainer);

    // 키 가이드
    const keyGuide = document.createElement("div");
    keyGuide.style.cssText = `
      position: absolute !important; bottom: 120px !important; left: 0 !important;
      width: ${W}px !important; display: flex !important;
      justify-content: center !important; z-index: 2147483647 !important;
    `;
    LANE_KEYS.forEach((key, i) => {
      const label = document.createElement("div");
      label.style.cssText = `
        width: ${NOTE_W}px !important; text-align: center !important;
        color: ${LANE_COLORS[i]} !important; font-family: monospace !important;
        font-size: 20px !important; font-weight: bold !important;
        text-shadow: 0 0 6px ${LANE_COLORS[i]} !important;
      `;
      label.textContent = key.toUpperCase();
      keyGuide.appendChild(label);
    });
    container.appendChild(keyGuide);

    document.body.appendChild(container);
  }

  // ===== UI 업데이트 =====
  function updateUI() {
    const score = document.getElementById("rg-score");
    const combo = document.getElementById("rg-combo");
    if (score) score.textContent = `Score: ${gameState.score}`;
    if (combo) combo.textContent = `Combo: ${gameState.combo}`;
  }

  function setStatus(msg) {
    const el = document.getElementById("rg-status");
    if (el) el.textContent = msg;
  }

  // ===== Canvas 렌더링 =====
  function render() {
    if (!ctx) return;

    // 높이 체크는 한 번만 (resize 핸들러에서 관리)
    const hitY = getHitY();

    // 배경
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
    ctx.fillRect(0, 0, W, H);

    // 레인 구분선
    const padding = (W - LANE_COUNT * NOTE_W) / 2;
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= LANE_COUNT; i++) {
      ctx.beginPath();
      ctx.moveTo(padding + i * NOTE_W, 0);
      ctx.lineTo(padding + i * NOTE_W, H);
      ctx.stroke();
    }

    // 판정선
    ctx.strokeStyle = "rgba(255, 50, 50, 0.9)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, hitY);
    ctx.lineTo(W, hitY);
    ctx.stroke();

    // 판정선 글로우
    ctx.strokeStyle = "rgba(255, 100, 100, 0.3)";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(0, hitY);
    ctx.lineTo(W, hitY);
    ctx.stroke();

    // 노트 렌더링 (최적화)
    for (const note of notes) {
      const x = getLaneX(note.lane);
      const color = LANE_COLORS[note.lane];
      const r = 6;

      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 15;
      roundRect(ctx, x - NOTE_W / 2 + 4, note.y - NOTE_H / 2, NOTE_W - 8, NOTE_H, r);
      ctx.fill();

      ctx.shadowBlur = 0;
    }

    // 이펙트 렌더링
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      const alpha = e.life / e.maxLife;

      if (e.type === "text") {
        ctx.globalAlpha = alpha;
        ctx.font = "bold 28px Arial";
        ctx.textAlign = "center";
        ctx.fillStyle = e.color;
        ctx.shadowColor = e.color;
        ctx.shadowBlur = 12;
        ctx.fillText(e.text, e.x, e.y);
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
        e.y -= 1.2;
      } else if (e.type === "particle") {
        ctx.globalAlpha = alpha * 0.8;
        ctx.fillStyle = e.color;
        for (const p of e.particles) {
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.08;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      e.life--;
      if (e.life <= 0) effects.splice(i, 1);
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // ===== 노트 생성 =====
  function spawnNote() {
    const lane = Math.floor(Math.random() * LANE_COUNT);
    notes.push({ lane, y: -NOTE_H });
  }

  // ===== 히트 이펙트 =====
  function createHitEffect(lane, text, color) {
    const x = getLaneX(lane);
    const hitY = getHitY();

    effects.push({
      type: "text",
      x,
      y: hitY - 40,
      text,
      color,
      life: 45,
      maxLife: 45,
    });

    const particles = [];
    for (let i = 0; i < 20; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 3;
      particles.push({
        x,
        y: hitY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2,
        r: 2 + Math.random() * 3,
      });
    }
    effects.push({
      type: "particle",
      x,
      y: hitY,
      color,
      particles,
      life: 35,
      maxLife: 35,
    });
  }

  // ===== 판정 처리 =====
  function judge(lane) {
    if (!gameState.active) return;

    const hitY = getHitY();
    let closest = null;
    let closestDist = Infinity;

    for (const note of notes) {
      if (note.lane !== lane) continue;
      const dist = Math.abs(note.y - hitY);
      if (dist < closestDist) {
        closestDist = dist;
        closest = note;
      }
    }

    if (!closest) return;

    let text, color, score;

    if (closestDist < HIT_PERFECT) {
      text = "PERFECT!";
      color = "#00ff88";
      score = 150;
      gameState.combo++;
    } else if (closestDist < HIT_GOOD) {
      text = "GOOD";
      color = "#ffea00";
      score = 75;
      gameState.combo++;
    } else {
      text = "MISS";
      color = "#ff4444";
      score = 0;
      gameState.combo = 0;
    }

    if (score > 0) {
      gameState.score += score * (1 + Math.floor(gameState.combo / 10));
      if (gameState.combo > gameState.maxCombo)
        gameState.maxCombo = gameState.combo;
    }

    createHitEffect(lane, text, color);

    const idx = notes.indexOf(closest);
    if (idx !== -1) notes.splice(idx, 1);

    updateUI();
  }

  // ===== 메인 게임 루프 =====
  function gameLoop() {
    if (!gameState.active) {
      animFrameId = null;
      return;
    }

    const hitY = getHitY();

    // 노트 이동 및 미스 처리
    for (let i = notes.length - 1; i >= 0; i--) {
      notes[i].y += NOTE_SPEED;
      if (notes[i].y > hitY + HIT_GOOD + 10) {
        createHitEffect(notes[i].lane, "MISS", "#ff4444");
        gameState.combo = 0;
        updateUI();
        notes.splice(i, 1);
      }
    }

    // 자동 스폰
    if (!gameState.audioReady) {
      autoSpawnTimer++;
      if (autoSpawnTimer >= AUTO_SPAWN_INTERVAL) {
        autoSpawnTimer = 0;
        if (AUTO_SPAWN_PATTERN[beatPatternIndex]) {
          spawnNote();
        }
        beatPatternIndex = (beatPatternIndex + 1) % AUTO_SPAWN_PATTERN.length;
      }
    }

    render();
    animFrameId = requestAnimationFrame(gameLoop);
  }

  // ===== 이벤트 리스너 =====
  function setupEventListeners() {
    keydownHandler = (e) => {
      if (e.key === "Escape" || e.code === "Escape") {
        toggleGame();
        e.stopPropagation();
        return;
      }

      const idx = LANE_KEYS.indexOf(e.key.toLowerCase());
      if (idx !== -1 && gameState.active) {
        judge(idx);
      }
    };

    visibilityHandler = () => {
      if (document.hidden && gameState.active) {
        pauseGame();
      }
    };

    resizeHandler = onWindowResize;

    document.addEventListener("keydown", keydownHandler, true);
    document.addEventListener("visibilitychange", visibilityHandler);
    window.addEventListener("resize", resizeHandler);
  }

  function removeEventListeners() {
    if (keydownHandler) {
      document.removeEventListener("keydown", keydownHandler, true);
      keydownHandler = null;
    }
    if (visibilityHandler) {
      document.removeEventListener("visibilitychange", visibilityHandler);
      visibilityHandler = null;
    }
    if (resizeHandler) {
      window.removeEventListener("resize", resizeHandler);
      resizeHandler = null;
    }
  }

  // ===== 게임 제어 =====
  function pauseGame() {
    gameState.active = false;
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    if (container) container.style.display = "none";
    console.log("[Overlay] 게임 일시중지");
  }

  function resumeGame() {
    gameState.active = true;
    if (container) container.style.display = "block";
    gameLoop();
    console.log("[Overlay] 게임 재개");
  }

  window.toggleGame = function () {
    if (gameState.active) {
      pauseGame();
    } else {
      resumeGame();
    }
  };

  // ===== 윈도우 리사이즈 =====
  function onWindowResize() {
    H = window.innerHeight;
    if (canvas) {
      canvas.height = H;
      canvas.style.height = H + "px";
    }
    if (container) {
      container.style.height = H + "px";
    }
  }

  // ===== 오디오 캡처 =====
  function startAudioCapture(streamId) {
    console.log("[Overlay] startAudioCapture called with streamId:", streamId);

    if (!streamId) {
      console.log("[Overlay] streamId is null - trying microphone...");
      tryMicrophone();
      return;
    }

    console.log("[Overlay] Attempting tabCapture (timeout: 3s)...");

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("timeout")), 3000);
    });

    Promise.race([
      navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: "tab",
            chromeMediaSourceId: streamId
          }
        },
        video: false
      }),
      timeoutPromise
    ])
      .then((stream) => {
        console.log("[Overlay] ✅ tabCapture success!");
        connectAudioStream(stream);
      })
      .catch((err) => {
        console.log("[Overlay] tabCapture failed - trying microphone...");
        tryMicrophone();
      });
  }

  function tryMicrophone() {
    console.log("[Overlay] Attempting microphone capture...");
    setStatus("🎤 마이크 설정 중...");

    navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      },
      video: false
    })
      .then((stream) => {
        console.log("[Overlay] ✅ Microphone success!");
        setStatus("🎤 마이크 음성 감지 중...");
        connectAudioStream(stream);
      })
      .catch((err) => {
        console.log("[Overlay] Microphone failed:", err.message);
        setStatus("🎮 자동 타이밍 모드");
        enableAutoSpawn();
      });
  }

  function connectAudioStream(stream) {
    audioCtx = new AudioContext();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.55;
    dataArray = new Uint8Array(analyser.frequencyBinCount);

    const src = audioCtx.createMediaStreamSource(stream);
    src.connect(analyser);

    console.log("[Overlay] Audio analysis STARTED");

    beatDetecting = true;
    gameState.audioReady = false;
    detectBeat();
  }

  function enableAutoSpawn() {
    gameState.audioReady = false;
  }

  function detectBeat() {
    if (!beatDetecting || !analyser) return;

    analyser.getByteFrequencyData(dataArray);

    // 다중 대역 분석 (최적화: 한 번만 계산)
    const bass = dataArray.slice(0, 8).reduce((a, b) => a + b, 0) / 8;
    const lowMid = dataArray.slice(20, 60).reduce((a, b) => a + b, 0) / 40;
    const mid = dataArray.slice(60, 100).reduce((a, b) => a + b, 0) / 40;
    const high = dataArray.slice(100, 150).reduce((a, b) => a + b, 0) / 50;

    const energy = bass * 0.7 + lowMid * 0.2 + mid * 0.08 + high * 0.02;
    const now = audioCtx.currentTime;

    if (energy > BEAT_THRESHOLD && now - lastBeatTime > BEAT_COOLDOWN) {
      lastBeatTime = now;
      console.log(
        `[BEAT] energy:${energy.toFixed(1)} | bass:${bass.toFixed(0)} threshold:${BEAT_THRESHOLD}`
      );
      spawnNote();
      gameState.audioReady = true;
    }

    requestAnimationFrame(detectBeat);
  }

  // ===== 게임 정리 (메모리 누수 방지) =====
  function cleanupGame() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }

    beatDetecting = false;

    if (audioCtx) {
      audioCtx.close();
      audioCtx = null;
      analyser = null;
      dataArray = null;
    }

    notes = [];
    effects = [];

    removeEventListeners();

    if (container) {
      container.remove();
      container = null;
      canvas = null;
      ctx = null;
      uiContainer = null;
    }

    console.log("[Overlay] Cleanup complete");
  }

  // ===== 게임 초기화 =====
  function initGame() {
    console.log("[Overlay] initGame() starting...");

    createOverlay();
    setupEventListeners();

    gameState.active = true;
    animFrameId = requestAnimationFrame(gameLoop);

    // 오디오 캡처 시작 (streamId는 content.js를 통해 수신)
    startAudioCapture(null);

    console.log("[Overlay] Initialized successfully");
  }

  // DOM 준비 후 시작
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initGame);
  } else {
    initGame();
  }

  // 페이지 언로드 시 정리
  window.addEventListener("unload", cleanupGame);
}

// ===== content.js로부터 메시지 수신 =====
window.addEventListener("message", (event) => {
  if (!event.data || typeof event.data !== "object") return;
  if (!event.data.type) return;

  const type = event.data.type;

  if (type === "RHYTHM_TOGGLE" && window.toggleGame) {
    window.toggleGame();
  }
  if (type === "RHYTHM_BEAT") {
    gameState.audioReady = true;
    spawnNote();
  }
  if (type === "RHYTHM_STATUS") {
    setStatus(event.data.msg);
  }
  if (type === "RHYTHM_STREAM_ID") {
    console.log("[Overlay] RHYTHM_STREAM_ID received, streamId:", event.data.streamId);
    startAudioCapture(event.data.streamId);
  }
});
