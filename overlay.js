// ====== Rhythm Game Overlay ======
// Three.js 의존성 없이 Canvas 2D로 직접 렌더링
// YouTube/Spotify 탭 오디오를 직접 캡처하여 비트 감지

if (window.__RHYTHM_GAME_LOADED__) {
  console.log("Rhythm game already loaded - toggling");
  if (window.toggleGame) window.toggleGame();
} else {
  window.__RHYTHM_GAME_LOADED__ = true;

  // ===== 상태 변수 =====
  let canvas, ctx, container, uiContainer;
  let animFrameId = null;
  let autoSpawnTimer = 0;        // 오디오 없을 때 자동 스폰 타이머
  let keydownHandler = null;     // 이벤트 리스너 참조 저장 (제거용)
  let visibilityHandler = null;

  // 오디오 캡처 변수
  let audioCtx = null;
  let analyser = null;
  let dataArray = null;
  let beatDetecting = false;
  let lastBeatTime = 0;

  // ── 비트 감지 파라미터 (고감도 모드) ──
  const BEAT_THRESHOLD = 75;
  const BEAT_COOLDOWN = 0.15;
  const BEAT_THRESHOLD_DECAY = 0.98;  // 임계값 감소 계수

  let notes = [];
  let effects = [];
  let beatPattern = [];           // 자동 스폰 비트 패턴 (Spotify 모드용)
  let beatPatternIndex = 0;
  const AUTO_SPAWN_PATTERN = [    // 더 빈번한 비트 패턴 (8박 반복, 고감도 모드)
    true, true, true, false,      // 1박, 2박, 3박, 4박 skip
    true, false, true, true       // 5박, 6박 skip, 7박, 8박
  ];

  const gameState = {
    score: 0,
    combo: 0,
    maxCombo: 0,
    active: true,   // false = 일시정지/숨김
    audioReady: false, // content.js가 RHYTHM_BEAT 메시지를 보내면 true로 변경
  };

  // ===== 설정 =====
  const W = 420;        // 오버레이 너비 (px)
  let H = window.innerHeight;

  const LANE_COUNT = 4;
  const LANE_COLORS = ["#00e5ff", "#ff4081", "#76ff03", "#ffea00"];
  const LANE_KEYS = ["d", "f", "j", "k"];
  // 판정선: 화면 아래에서 15%
  const HIT_Y_RATIO = 0.82;
  const NOTE_W = 80;
  const NOTE_H = 28;
  const NOTE_SPEED = 5;          // px/frame
  const HIT_PERFECT = 24;        // px 범위
  const HIT_GOOD = 50;
  const AUTO_SPAWN_INTERVAL = 30; // 오디오 없을 때 자동 스폰 (프레임 단위, 고감도 모드)

  // 레인 X 위치 계산
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

    // 기존 오버레이가 있으면 제거
    const existing = document.getElementById("rhythm-overlay-container");
    if (existing) existing.remove();

    container = document.createElement("div");
    container.id = "rhythm-overlay-container";
    container.style.cssText = `
      position: fixed !important;
      top: 0 !important;
      right: 0 !important;
      width: ${W}px !important;
      height: 100vh !important;
      z-index: 2147483647 !important;
      pointer-events: none !important;
      overflow: hidden !important;
    `;

    canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    canvas.style.cssText = `
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      width: ${W}px !important;
      height: ${H}px !important;
      z-index: 2147483647 !important;
      display: block !important;
    `;

    ctx = canvas.getContext("2d");
    container.appendChild(canvas);

    // UI 레이어 (점수 등)
    uiContainer = document.createElement("div");
    uiContainer.id = "rhythm-game-ui";
    uiContainer.style.cssText = `
      position: absolute !important;
      top: 10px !important;
      left: 10px !important;
      color: white !important;
      font-family: 'Segoe UI', Arial, sans-serif !important;
      font-size: 16px !important;
      z-index: 2147483647 !important;
      text-shadow: 1px 1px 4px rgba(0,0,0,0.9) !important;
      pointer-events: none !important;
      line-height: 1.8 !important;
      width: 150px !important;
    `;
    // TrustedTypes 정책 준수: innerHTML 대신 createElement + textContent 사용
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

    // 키 가이드 레이블
    const keyGuide = document.createElement("div");
    keyGuide.style.cssText = `
      position: absolute !important;
      bottom: 120px !important;
      left: 0 !important;
      width: ${W}px !important;
      display: flex !important;
      justify-content: center !important;
      gap: 0px !important;
      pointer-events: none !important;
      z-index: 2147483647 !important;
    `;
    LANE_KEYS.forEach((key, i) => {
      const label = document.createElement("div");
      label.style.cssText = `
        width: ${NOTE_W}px !important;
        text-align: center !important;
        color: ${LANE_COLORS[i]} !important;
        font-family: monospace !important;
        font-size: 20px !important;
        font-weight: bold !important;
        text-shadow: 0 0 6px ${LANE_COLORS[i]} !important;
        pointer-events: none !important;
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

    H = window.innerHeight;
    if (canvas.height !== H) {
      canvas.height = H;
      canvas.style.height = H + "px";
      container.style.height = H + "px";
    }

    const hitY = getHitY();

    // 배경: 반투명 검정
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
    ctx.fillRect(0, 0, W, H);

    // 레인 구분선
    const padding = (W - LANE_COUNT * NOTE_W) / 2;
    for (let i = 0; i <= LANE_COUNT; i++) {
      ctx.strokeStyle = "rgba(255,255,255,0.1)";
      ctx.lineWidth = 1;
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

    // 노트 렌더링
    for (const note of notes) {
      const x = getLaneX(note.lane);
      const color = LANE_COLORS[note.lane];

      // 글로우 효과
      ctx.shadowColor = color;
      ctx.shadowBlur = 15;

      // 노트 사각형
      ctx.fillStyle = color;
      const r = 6;
      roundRect(ctx, x - NOTE_W / 2 + 4, note.y - NOTE_H / 2, NOTE_W - 8, NOTE_H, r);
      ctx.fill();

      // 하이라이트
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      roundRect(ctx, x - NOTE_W / 2 + 4, note.y - NOTE_H / 2, NOTE_W - 8, NOTE_H * 0.4, r);
      ctx.fill();

      ctx.shadowBlur = 0;
    }

    // 이펙트 렌더링
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      const alpha = e.life / e.maxLife;

      if (e.type === "text") {
        ctx.globalAlpha = alpha;
        ctx.font = `bold ${e.fontSize || 28}px Arial`;
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
          p.vy += 0.08; // 중력
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

  // 모서리 둥근 사각형 유틸
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

    // 텍스트 이펙트
    effects.push({
      type: "text",
      x,
      y: hitY - 40,
      text,
      color,
      life: 45,
      maxLife: 45,
    });

    // 파티클 이펙트
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

    // 해당 레인에서 가장 가까운 노트 찾기
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
      text = "PERFECT!"; color = "#00ff88"; score = 150;
      gameState.combo++;
    } else if (closestDist < HIT_GOOD) {
      text = "GOOD"; color = "#ffea00"; score = 75;
      gameState.combo++;
    } else {
      text = "MISS"; color = "#ff4444"; score = 0;
      gameState.combo = 0;
    }

    if (score > 0) {
      gameState.score += score * (1 + Math.floor(gameState.combo / 10));
      if (gameState.combo > gameState.maxCombo)
        gameState.maxCombo = gameState.combo;
    }

    createHitEffect(lane, text, color);

    // 노트 제거
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
        // 판정선 밑으로 지나간 노트: MISS
        createHitEffect(notes[i].lane, "MISS", "#ff4444");
        gameState.combo = 0;
        updateUI();
        notes.splice(i, 1);
      }
    }

    // 자동 스폰: 음악 감지 실패 시 자동 비트 패턴
    if (!gameState.audioReady) {
      autoSpawnTimer++;
      if (autoSpawnTimer >= AUTO_SPAWN_INTERVAL) {
        autoSpawnTimer = 0;
        
        // 비트 패턴에 따라 노트 생성
        if (AUTO_SPAWN_PATTERN[beatPatternIndex]) {
          const lane = beatPatternIndex % 4;
          notes.push({ lane, y: -NOTE_H });
        }
        
        beatPatternIndex = (beatPatternIndex + 1) % AUTO_SPAWN_PATTERN.length;
      }
    }

    render();
    animFrameId = requestAnimationFrame(gameLoop);
  }



  // ===== 이벤트 리스너  // ===== 이벤트 리스너 설정 =====
  function setupEventListeners() {
    keydownHandler = (e) => {
      // ESC: 오버레이 토글 (숨기기/보이기)
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
        // 탭이 숨겨지면 일시정지
        pauseGame();
      }
    };

    document.addEventListener("keydown", keydownHandler, true); // capture 단계에서 먼저 받기
    document.addEventListener("visibilitychange", visibilityHandler);
    window.addEventListener("resize", onWindowResize);
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
    window.removeEventListener("resize", onWindowResize);
  }

  // ===== 게임 제어 =====
  function pauseGame() {
    gameState.active = false;
    if (container) container.style.display = "none";
    console.log("게임 일시중지");
  }

  function resumeGame() {
    gameState.active = true;
    if (container) container.style.display = "block";
    animFrameId = requestAnimationFrame(gameLoop);
    console.log("게임 재개");
  }

  // ESC 토글: 숨기기 <-> 보이기
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

  // ===== content.js로부터 비트/상태 메시지 수신 등록 =====
  function listenForBeatMessages() {
    // 외부에서 spawnNote, setStatus 접근할 수 있도록 전역 노출
    window.__rhythmSpawnNote__ = () => {
      if (gameState.active) {
        spawnNote();
        gameState.audioReady = true; // 오디오 연결됨 → 자동스폰 중단
      }
    };
    window.__rhythmSetStatus__ = (msg) => {
      setStatus(msg);
      if (msg.includes("연결됨")) gameState.audioReady = true;
    };
  }

  // ===== 오디오 캡처 및 비트 감지 =====
  function startAudioCapture(streamId) {
    console.log("[Overlay] startAudioCapture called with streamId:", streamId);
    
    if (!streamId) {
      console.log("[Overlay] ⚠️ streamId is null/undefined - trying microphone instead...");
      tryMicrophone();
      return;
    }

    console.log("[Overlay] Attempting tabCapture (timeout: 3s)...");
    
    // 3초 타임아웃
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
    ]).then((stream) => {
      console.log("[Overlay] ✅ tabCapture success!");
      connectAudioStream(stream);

    }).catch((err) => {
      console.log("[Overlay] tabCapture failed - trying microphone...");
      tryMicrophone();
    });
  }

  // ===== 마이크로 오디오 캡처 =====
  function tryMicrophone() {
    console.log("[Overlay] Attempting microphone capture...");
    
    setStatus("🎤 마이크 설정 중... (스테레오 믹스 필요)");

    navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      },
      video: false
    }).then((stream) => {
      console.log("[Overlay] ✅ Microphone success!");
      setStatus("🎤 마이크 음성 감지 중...");
      connectAudioStream(stream);

    }).catch((err) => {
      console.log("[Overlay] Microphone failed:", err.message);
      console.log("[Overlay] Falling back to auto beat mode");
      setStatus("🎮 자동 타이밍 모드");
      enableAutoSpawn();
    });
  }

  // ===== 오디오 스트림 연결 =====
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

  // ===== 자동 비트 모드 활성화 =====
  function enableAutoSpawn() {
    gameState.audioReady = false;
  }

  function detectBeat() {
    if (!beatDetecting || !analyser) {
      return;
    }

    analyser.getByteFrequencyData(dataArray);

    // 저음역 분석
    let bass = 0;
    const bassEnd = Math.min(8, dataArray.length);
    for (let i = 0; i < bassEnd; i++) bass += dataArray[i];
    bass /= bassEnd;

    let lowMid = 0;
    const lowMidStart = Math.floor(dataArray.length * 0.05);
    const lowMidEnd = Math.floor(dataArray.length * 0.15);
    for (let i = lowMidStart; i < lowMidEnd; i++) lowMid += dataArray[i];
    lowMid /= (lowMidEnd - lowMidStart);

    let mid = 0;
    const midStart = Math.floor(dataArray.length * 0.15);
    const midEnd = Math.floor(dataArray.length * 0.4);
    for (let i = midStart; i < midEnd; i++) mid += dataArray[i];
    mid /= (midEnd - midStart);

    let high = 0;
    const highStart = Math.floor(dataArray.length * 0.4);
    const highEnd = Math.floor(dataArray.length * 0.7);
    for (let i = highStart; i < highEnd; i++) high += dataArray[i];
    high /= (highEnd - highStart);

    const combined = bass * 0.7 + lowMid * 0.2 + mid * 0.08 + high * 0.02;
    const now = audioCtx.currentTime;

    // 매초마다 에너지 값 출력
    if (Math.floor(now) !== Math.floor(lastBeatTime)) {
      console.log(`[Audio] energy:${combined.toFixed(1)} bass:${bass.toFixed(0)} threshold:${BEAT_THRESHOLD}`);
    }

    // 비트 감지
    if (combined > BEAT_THRESHOLD && now - lastBeatTime > BEAT_COOLDOWN) {
      lastBeatTime = now;
      console.log(`[BEAT!] energy:${combined.toFixed(1)} - spawning note`);
      spawnNote();
      gameState.audioReady = true;
    }

    requestAnimationFrame(detectBeat);
  }

    // ===== 게임 초기화 =====
  function initGame() {
    console.log("Rhythm Game: initGame() starting...");

    createOverlay();
    setupEventListeners();
    listenForBeatMessages();

    // 게임 루프 시작
    gameState.active = true;
    animFrameId = requestAnimationFrame(gameLoop);

    console.log("Rhythm Game: initialized successfully");
  }

  // DOM 준비 후 시작
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initGame);
  } else {
    initGame();
  }
}

// content.js(isolated world)에서 오는 이벤트 수신
window.addEventListener("message", (event) => {
  // 올바른 데이터 구조만 처리
  if (!event.data || typeof event.data !== "object") return;
  if (!event.data.type) return;
  
  const type = event.data.type;
  
  if (type === "RHYTHM_TOGGLE" && window.toggleGame) {
    window.toggleGame();
  }
  if (type === "RHYTHM_BEAT") {
    gameState.audioReady = true;
    if (window.__rhythmSpawnNote__) window.__rhythmSpawnNote__();
  }
  if (type === "RHYTHM_STATUS") {
    if (window.__rhythmSetStatus__) window.__rhythmSetStatus__(event.data.msg);
  }
  if (type === "RHYTHM_STREAM_ID") {
    console.log("[Overlay] RHYTHM_STREAM_ID received, streamId:", event.data.streamId);
    startAudioCapture(event.data.streamId);
  }
});
