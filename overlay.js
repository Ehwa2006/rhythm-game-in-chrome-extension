// ====== Rhythm Game Overlay v3.1 ======
// 버그 수정:
//   - 롱노트 바디 렌더링 (tailCapY 음수 시 bodyH 음수 버그)
//   - 게임오버 후 render 루프 유지 (흔들림/랭크 화면 정상 작동)
// 변경:
//   - 자동 스폰 모드 완전 삭제 (오디오 연결 필수)
//   - 스페이스바 → 게임 완전 종료 + 오버레이 제거

if (window.__RHYTHM_GAME_LOADED__) {
  if (window.toggleGame) window.toggleGame();
} else {
  window.__RHYTHM_GAME_LOADED__ = true;

  // ===== DOM/Canvas =====
  let canvas, ctx, container, uiContainer;
  let animFrameId = null;
  let keydownHandler = null, keyupHandler = null;
  let visibilityHandler = null, resizeHandler = null;
  let gameOverState = false;

  // ===== 오디오 =====
  let audioCtx  = null;   // 비트 감지용
  let sfxCtx    = null;   // 사운드 이펙트용
  let analyser  = null;
  let dataArray = null;
  let beatDetecting = false;
  let lastBeatTime  = 0;
  const BEAT_THRESHOLD = 75;
  const BEAT_COOLDOWN  = 0.15;

  // ===== 게임 오브젝트 =====
  let notes     = [];
  let effects   = [];
  let keysHeld  = [false, false, false, false];
  let lanePress = [0, 0, 0, 0];

  // 화면 흔들림 / 비트 펄스
  let shakeAmount = 0;
  let beatPulse   = 0;

  // ===== 통계 =====
  let perfectCount = 0, goodCount = 0, badCount = 0, missCount = 0, totalNotes = 0;

  // ===== 세션 최고기록 (리셋 후에도 유지) =====
  if (!window.__rhythmSessionHigh__) window.__rhythmSessionHigh__ = 0;

  // ===== 게임 상태 =====
  const MAX_HP = 100;
  const gameState = {
    score: 0, combo: 0, maxCombo: 0, hp: MAX_HP, active: false,
  };

  // ===== 설정 상수 =====
  const W           = 420;
  let   H           = window.innerHeight;
  const LANE_COUNT  = 4;
  const LANE_COLORS = ["#00e5ff", "#ff4081", "#76ff03", "#ffea00"];
  const LANE_KEYS   = ["d", "f", "j", "k"];
  const HIT_Y_RATIO = 0.82;
  const NOTE_W      = 80;
  const NOTE_H      = 28;
  const BASE_SPEED  = 5;
  const MAX_SPEED   = 11;
  const HIT_PERFECT = 24;
  const HIT_GOOD    = 50;
  const HIT_BAD     = 80;

  const HP_MISS    = 12;
  const HP_BAD     = 5;
  const HP_RECOVER = 2;

  // 롱노트
  const HOLD_CHANCE          = 0.28;  // 28% 확률로 롱노트
  const HOLD_MIN_LEN         = 100;   // px
  const HOLD_MAX_LEN         = 260;   // px
  const HOLD_SCORE_PER_FRAME = 3;

  // ===== 헬퍼 =====
  const getLaneX = i => (W - LANE_COUNT * NOTE_W) / 2 + i * NOTE_W + NOTE_W / 2;
  const getHitY  = () => Math.floor(H * HIT_Y_RATIO);
  const getNoteSpeed = () => Math.min(BASE_SPEED + Math.floor(gameState.score / 3000) * 0.8, MAX_SPEED);
  const getMultiplier = () =>
    gameState.combo >= 100 ? 4 : gameState.combo >= 50 ? 3 : gameState.combo >= 20 ? 2 : 1;

  function getAccuracy() {
    if (totalNotes === 0) return 100;
    return Math.round(
      (perfectCount * 100 + goodCount * 80 + badCount * 30) / (totalNotes * 100) * 1000
    ) / 10;
  }

  function getRank(acc) {
    if (acc >= 95) return { r: "S", c: "#ffea00" };
    if (acc >= 85) return { r: "A", c: "#00ff88" };
    if (acc >= 70) return { r: "B", c: "#00e5ff" };
    if (acc >= 55) return { r: "C", c: "#ff8800" };
    return           { r: "D", c: "#ff4444" };
  }

  // ===== 히트 사운드 =====
  const SFX = {
    perfect:    { freq: 880,  wave: "sine",     dur: 0.09, vol: 0.28 },
    good:       { freq: 660,  wave: "sine",     dur: 0.08, vol: 0.20 },
    bad:        { freq: 300,  wave: "square",   dur: 0.08, vol: 0.15 },
    miss:       { freq: 140,  wave: "sawtooth", dur: 0.13, vol: 0.11 },
    hold_start: { freq: 1050, wave: "sine",     dur: 0.06, vol: 0.20 },
    hold_end:   { freq: 1320, wave: "triangle", dur: 0.20, vol: 0.32 },
    milestone:  { freq: 1560, wave: "sine",     dur: 0.35, vol: 0.38 },
  };

  function playSound(type) {
    try {
      if (!sfxCtx || sfxCtx.state === "closed") sfxCtx = new AudioContext();
      const cfg = SFX[type];
      if (!cfg) return;
      const osc  = sfxCtx.createOscillator();
      const gain = sfxCtx.createGain();
      osc.connect(gain);
      gain.connect(sfxCtx.destination);
      osc.type = cfg.wave;
      osc.frequency.value = cfg.freq;
      const t = sfxCtx.currentTime;
      gain.gain.setValueAtTime(cfg.vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + cfg.dur);
      osc.start(t);
      osc.stop(t + cfg.dur + 0.02);
    } catch (_) {}
  }

  // ===== DOM 생성 =====
  function createOverlay() {
    H = window.innerHeight;
    const ex = document.getElementById("rhythm-overlay-container");
    if (ex) ex.remove();

    container = document.createElement("div");
    container.id = "rhythm-overlay-container";
    container.style.cssText = `
      position:fixed!important;top:0!important;right:0!important;
      width:${W}px!important;height:100vh!important;
      z-index:2147483647!important;pointer-events:none!important;overflow:hidden!important;
    `;

    canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    canvas.style.cssText = `
      position:absolute!important;top:0!important;left:0!important;
      width:${W}px!important;height:${H}px!important;
      z-index:2147483647!important;display:block!important;
    `;
    ctx = canvas.getContext("2d", { willReadFrequently: false });
    container.appendChild(canvas);

    // ── UI ──
    uiContainer = document.createElement("div");
    uiContainer.id = "rhythm-game-ui";
    uiContainer.style.cssText = `
      position:absolute!important;top:10px!important;left:10px!important;
      color:white!important;font-family:'Segoe UI',Arial,sans-serif!important;
      font-size:15px!important;z-index:2147483647!important;
      text-shadow:0 0 6px rgba(0,0,0,1),1px 1px 2px rgba(0,0,0,0.9)!important;
      pointer-events:none!important;line-height:2!important;width:200px!important;
    `;
    const mk = (id, txt, style) => {
      const d = document.createElement("div");
      d.id = id; d.textContent = txt;
      if (style) d.style.cssText = style;
      uiContainer.appendChild(d);
    };
    mk("rg-score",  "Score: 0");
    mk("rg-combo",  "Combo: 0");
    mk("rg-mult",   "×1",                    "font-size:13px;color:#888;");
    mk("rg-acc",    "ACC: 100.0%",           "font-size:13px;color:#7ec8e3;");
    mk("rg-hp",     "HP: ██████████ 100",   "font-size:12px;color:#ff6b6b;margin-top:2px;");
    mk("rg-speed",  "Speed ×1.0",            "font-size:11px;opacity:0.55;");
    mk("rg-best",   `Best: ${window.__rhythmSessionHigh__.toLocaleString()}`,
                                             "font-size:11px;color:#ffd700;opacity:0.8;");
    mk("rg-status", "🎵 오디오 연결 대기 중...", "font-size:11px;opacity:0.7;margin-top:4px;");
    container.appendChild(uiContainer);

    // ── 단축키 안내 (우하단) ──
    const hint = document.createElement("div");
    hint.style.cssText = `
      position:absolute!important;bottom:8px!important;left:0!important;
      width:${W}px!important;text-align:center!important;
      color:rgba(255,255,255,0.35)!important;font-size:11px!important;
      font-family:'Segoe UI',Arial,sans-serif!important;
      pointer-events:none!important;z-index:2147483647!important;
    `;
    hint.textContent = "ESC: 숨기기  |  SPACE: 게임 종료";
    container.appendChild(hint);

    // ── 키 가이드 ──
    const kg = document.createElement("div");
    kg.id = "rg-key-guide";
    kg.style.cssText = `
      position:absolute!important;left:0!important;
      width:${W}px!important;display:flex!important;
      justify-content:center!important;z-index:2147483647!important;pointer-events:none!important;
    `;
    LANE_KEYS.forEach((k, i) => {
      const lb = document.createElement("div");
      lb.style.cssText = `
        width:${NOTE_W}px!important;text-align:center!important;
        color:${LANE_COLORS[i]}!important;font-family:monospace!important;
        font-size:20px!important;font-weight:bold!important;
        text-shadow:0 0 8px ${LANE_COLORS[i]}!important;
      `;
      lb.textContent = k.toUpperCase();
      kg.appendChild(lb);
    });
    container.appendChild(kg);

    document.body.appendChild(container);
    positionKeyGuide();
  }

  function positionKeyGuide() {
    const kg = document.getElementById("rg-key-guide");
    if (kg) kg.style.top = (getHitY() + 14) + "px";
  }

  // ===== UI 업데이트 =====
  function updateUI() {
    const acc  = getAccuracy();
    const mult = getMultiplier();
    const hp   = Math.max(0, Math.round(gameState.hp));
    const bars = Math.round(hp / MAX_HP * 10);
    const spd  = getNoteSpeed().toFixed(1);

    const $  = id => document.getElementById(id);
    const st = (id, k, v) => { const e = $(id); if (e) e.style[k] = v; };
    const tx = (id, v)     => { const e = $(id); if (e) e.textContent = v; };

    tx("rg-score", `Score: ${gameState.score.toLocaleString()}`);
    tx("rg-combo", `Combo: ${gameState.combo}`);
    tx("rg-mult",  `×${mult}`);
    st("rg-mult",  "color", mult >= 3 ? "#ff4081" : mult >= 2 ? "#ffea00" : "#888");
    tx("rg-acc",   `ACC: ${acc}%`);
    st("rg-acc",   "color", acc >= 95 ? "#ffea00" : acc >= 85 ? "#00ff88" : acc >= 70 ? "#7ec8e3" : "#ff8800");
    tx("rg-hp",    `HP: ${"█".repeat(bars)}${"░".repeat(10 - bars)} ${hp}`);
    st("rg-hp",    "color", hp < 30 ? "#ff2244" : hp < 60 ? "#ffaa00" : "#ff6b6b");
    tx("rg-speed", `Speed ×${spd}`);
    tx("rg-best",  `Best: ${window.__rhythmSessionHigh__.toLocaleString()}`);
  }

  function setStatus(msg) {
    const el = document.getElementById("rg-status");
    if (el) el.textContent = msg;
  }

  // ===== Canvas 렌더링 =====
  function render() {
    if (!ctx) return;

    const hitY = getHitY();
    const pad  = (W - LANE_COUNT * NOTE_W) / 2;

    ctx.save();

    // ── 화면 흔들림 ──
    if (shakeAmount > 0.4) {
      ctx.translate(
        (Math.random() - 0.5) * shakeAmount * 2,
        (Math.random() - 0.5) * shakeAmount * 2
      );
      shakeAmount *= 0.78;
    } else {
      shakeAmount = 0;
    }

    ctx.clearRect(-30, -30, W + 60, H + 60);
    ctx.fillStyle = "rgba(0,0,0,0.80)";
    ctx.fillRect(-30, -30, W + 60, H + 60);

    // ── 비트 펄스 배경 ──
    if (beatPulse > 0.01) {
      const grad = ctx.createRadialGradient(W / 2, H * 0.5, 0, W / 2, H * 0.5, W);
      grad.addColorStop(0, `rgba(255,255,255,${beatPulse * 0.10})`);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      beatPulse *= 0.86;
    }

    // ── 레인 누름 하이라이트 ──
    for (let i = 0; i < LANE_COUNT; i++) {
      const lx = pad + i * NOTE_W;
      if (lanePress[i] > 0) {
        const a = lanePress[i] / 14;
        const g = ctx.createLinearGradient(lx, hitY - 180, lx, hitY + 90);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, `${LANE_COLORS[i]}${Math.round(a * 60).toString(16).padStart(2, "0")}`);
        ctx.fillStyle = g;
        ctx.fillRect(lx, hitY - 180, NOTE_W, 270);
        lanePress[i]--;
      }
    }

    // ── 레인 구분선 ──
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= LANE_COUNT; i++) {
      ctx.beginPath();
      ctx.moveTo(pad + i * NOTE_W, 0);
      ctx.lineTo(pad + i * NOTE_W, H);
      ctx.stroke();
    }

    // ── 판정선 버튼 박스 ──
    for (let i = 0; i < LANE_COUNT; i++) {
      const lx      = pad + i * NOTE_W + 4;
      const bh      = NOTE_H * 1.4;
      const by      = hitY - NOTE_H * 0.7;
      const pressed = lanePress[i] > 0 || keysHeld[i];
      const color   = LANE_COLORS[i];

      ctx.shadowColor = color;
      ctx.shadowBlur  = pressed ? 20 : 5;
      ctx.strokeStyle = pressed ? color : `${color}55`;
      ctx.lineWidth   = pressed ? 2.5 : 1;
      roundRect(ctx, lx, by, NOTE_W - 8, bh, 6);
      ctx.stroke();
      ctx.shadowBlur = 0;

      if (pressed) {
        ctx.globalAlpha = 0.20;
        ctx.fillStyle   = color;
        roundRect(ctx, lx, by, NOTE_W - 8, bh, 6);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // ── HP 바 (판정선 위) ──
    const hpR = Math.max(0, gameState.hp) / MAX_HP;
    const hpC = hpR < 0.3 ? "#ff2244" : hpR < 0.6 ? "#ffaa00" : "#00ff88";
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, hitY - 11, W, 6);
    ctx.fillStyle   = hpC;
    ctx.shadowColor = hpC;
    ctx.shadowBlur  = 8;
    ctx.fillRect(0, hitY - 11, W * hpR, 6);
    ctx.shadowBlur = 0;

    // ── 판정선 ──
    ctx.strokeStyle = "rgba(255,60,60,0.92)";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, hitY); ctx.lineTo(W, hitY); ctx.stroke();
    ctx.strokeStyle = "rgba(255,100,100,0.18)";
    ctx.lineWidth = 16;
    ctx.beginPath(); ctx.moveTo(0, hitY); ctx.lineTo(W, hitY); ctx.stroke();

    // ── 노트 렌더링 ──
    for (const note of notes) {
      const x     = getLaneX(note.lane);
      const color = LANE_COLORS[note.lane];
      const dist  = Math.abs(note.y - hitY);
      const glow  = 8 + Math.max(0, 1 - dist / (hitY * 0.65)) * 24;

      if (note.isHold) {
        // ── 롱노트 렌더링 ──
        // note.y = 헤드 위치 (아래), note.y - holdLength = 테일 위치 (위)
        // 화면 좌표계: y가 클수록 아래
        const tailY  = note.y - note.holdLength;  // 테일 (항상 헤드보다 위)
        const headY  = note.activated ? hitY : note.y;  // 활성화 후 헤드는 판정선에 고정

        // 바디: 테일(위)에서 헤드(아래)까지
        // ★ 수정: tailY < headY가 보장되므로 Math.min/max로 클램프만 처리
        const bodyTop    = Math.max(-NOTE_H, tailY);      // 화면 위쪽 클램프
        const bodyBottom = Math.min(headY, H + NOTE_H);   // 화면 아래쪽 클램프
        const bodyH      = bodyBottom - bodyTop;

        if (bodyH > 0) {
          // 바디 그라디언트 (위→아래: 투명→진함)
          const grad = ctx.createLinearGradient(x, bodyTop, x, bodyBottom);
          grad.addColorStop(0, `${color}22`);
          grad.addColorStop(1, `${color}99`);
          ctx.fillStyle   = grad;
          ctx.fillRect(x - NOTE_W / 2 + 18, bodyTop, NOTE_W - 36, bodyH);
          // 바디 테두리
          ctx.strokeStyle = `${color}66`;
          ctx.lineWidth   = 1.5;
          ctx.strokeRect(x - NOTE_W / 2 + 18, bodyTop, NOTE_W - 36, bodyH);
        }

        // 테일 캡 (윗부분, 화면 안에 있을 때만)
        if (tailY >= -10 && tailY <= H && !note.activated) {
          ctx.fillStyle   = `${color}cc`;
          ctx.shadowColor = color;
          ctx.shadowBlur  = 10;
          roundRect(ctx, x - NOTE_W / 2 + 12, tailY - 8, NOTE_W - 24, 12, 4);
          ctx.fill();
          ctx.shadowBlur = 0;
        }

        // 활성화 중: 판정선 에너지 펄스
        if (note.activated && keysHeld[note.lane]) {
          const pulse     = 0.5 + Math.sin(Date.now() / 70) * 0.35;
          ctx.globalAlpha = pulse;
          ctx.fillStyle   = color;
          ctx.shadowColor = color;
          ctx.shadowBlur  = 28;
          ctx.fillRect(x - NOTE_W / 2 + 10, hitY - 6, NOTE_W - 20, 12);
          ctx.globalAlpha = 1;
          ctx.shadowBlur  = 0;
        }

        // 헤드 (활성화 전에만 렌더)
        if (!note.activated && note.y >= -NOTE_H && note.y <= H + NOTE_H) {
          // 헤드 본체
          ctx.fillStyle   = color;
          ctx.shadowColor = color;
          ctx.shadowBlur  = glow;
          roundRect(ctx, x - NOTE_W / 2 + 4, note.y - NOTE_H / 2, NOTE_W - 8, NOTE_H, 6);
          ctx.fill();
          ctx.shadowBlur  = 0;
          // 헤드 하이라이트
          ctx.fillStyle = "rgba(255,255,255,0.38)";
          roundRect(ctx, x - NOTE_W / 2 + 4, note.y - NOTE_H / 2, NOTE_W - 8, NOTE_H * 0.4, 6);
          ctx.fill();
          // 롱노트 표시 (중앙 흰 줄)
          ctx.fillStyle = "rgba(255,255,255,0.65)";
          ctx.fillRect(x - 14, note.y - 3, 28, 5);
        }

      } else {
        // ── 일반 노트 ──
        if (note.y < -NOTE_H || note.y > H + NOTE_H) continue;
        ctx.fillStyle   = color;
        ctx.shadowColor = color;
        ctx.shadowBlur  = glow;
        roundRect(ctx, x - NOTE_W / 2 + 4, note.y - NOTE_H / 2, NOTE_W - 8, NOTE_H, 6);
        ctx.fill();
        ctx.shadowBlur  = 0;
        ctx.fillStyle   = "rgba(255,255,255,0.32)";
        roundRect(ctx, x - NOTE_W / 2 + 4, note.y - NOTE_H / 2, NOTE_W - 8, NOTE_H * 0.38, 6);
        ctx.fill();
      }
    }

    // ── 이펙트 렌더링 ──
    for (let i = effects.length - 1; i >= 0; i--) {
      const e     = effects[i];
      const alpha = e.life / e.maxLife;

      switch (e.type) {
        case "text":
          ctx.globalAlpha = alpha;
          ctx.font        = `bold ${e.fontSize || 26}px 'Segoe UI', Arial`;
          ctx.textAlign   = "center";
          ctx.fillStyle   = e.color;
          ctx.shadowColor = e.color;
          ctx.shadowBlur  = 16;
          ctx.fillText(e.text, e.x, e.y);
          ctx.shadowBlur  = 0;
          ctx.globalAlpha = 1;
          e.y -= 1.8;
          break;

        case "particle":
          ctx.fillStyle = e.color;
          for (const p of e.particles) {
            ctx.globalAlpha = alpha * p.a;
            p.x += p.vx; p.y += p.vy; p.vy += 0.13; p.a *= 0.96;
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
          }
          ctx.globalAlpha = 1;
          break;

        case "flash":
          ctx.globalAlpha = alpha * e.intensity;
          ctx.fillStyle   = e.color;
          ctx.fillRect(0, 0, W, H);
          ctx.globalAlpha = 1;
          break;

        case "miss_bar": {
          const lx = pad + e.lane * NOTE_W + 4;
          ctx.globalAlpha = alpha * 0.5;
          ctx.fillStyle   = "#ff2244";
          ctx.fillRect(lx, hitY - NOTE_H * 0.7, NOTE_W - 8, NOTE_H * 1.4);
          ctx.globalAlpha = 1;
          break;
        }

        case "hold_bar": {
          const lx = pad + e.lane * NOTE_W;
          ctx.globalAlpha = alpha * 0.30;
          ctx.fillStyle   = e.color;
          ctx.fillRect(lx, 0, NOTE_W, H);
          ctx.globalAlpha = 1;
          break;
        }

        case "rank_shine": {
          // 게임오버 랭크 글자 글로우 펄스
          ctx.globalAlpha = alpha * 0.15;
          const sg = ctx.createRadialGradient(W / 2, H / 2 - 95, 0, W / 2, H / 2 - 95, 120);
          sg.addColorStop(0, e.color);
          sg.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = sg;
          ctx.fillRect(0, 0, W, H);
          ctx.globalAlpha = 1;
          break;
        }
      }

      e.life--;
      if (e.life <= 0) effects.splice(i, 1);
    }

    // ── 게임오버 화면 ──
    if (gameOverState) {
      const acc  = getAccuracy();
      const rank = getRank(acc);
      const cx   = W / 2;
      const cy   = H / 2;

      // 어두운 오버레이
      ctx.fillStyle = "rgba(0,0,0,0.86)";
      ctx.fillRect(-30, -30, W + 60, H + 60);

      // 랭크 배경 원
      const rg = ctx.createRadialGradient(cx, cy - 80, 0, cx, cy - 80, 100);
      rg.addColorStop(0, `${rank.c}33`);
      rg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = rg;
      ctx.fillRect(cx - 100, cy - 180, 200, 200);

      // 랭크 문자
      ctx.textAlign   = "center";
      ctx.font        = "bold 96px Arial";
      ctx.fillStyle   = rank.c;
      ctx.shadowColor = rank.c;
      ctx.shadowBlur  = 40;
      ctx.fillText(rank.r, cx, cy - 60);
      ctx.shadowBlur  = 0;

      // 새 기록 배지
      const isNewRecord = gameState.score > 0 && gameState.score >= window.__rhythmSessionHigh__;
      if (isNewRecord) {
        ctx.font      = "bold 16px Arial";
        ctx.fillStyle = "#ffd700";
        ctx.shadowColor = "#ffd700"; ctx.shadowBlur = 14;
        ctx.fillText("✨ SESSION BEST!", cx, cy - 12);
        ctx.shadowBlur = 0;
      }

      // 구분선
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(cx - 110, cy + 5);
      ctx.lineTo(cx + 110, cy + 5);
      ctx.stroke();

      // 점수 정보
      ctx.font      = "bold 20px Arial";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(`${gameState.score.toLocaleString()}점`, cx, cy + 35);

      ctx.font      = "15px Arial";
      ctx.fillStyle = "#cccccc";
      ctx.fillText(`Max Combo: ${gameState.maxCombo}`, cx, cy + 62);

      ctx.font      = "15px Arial";
      ctx.fillStyle = rank.c;
      ctx.fillText(`Accuracy: ${acc}%`, cx, cy + 88);

      // 판정 세부
      ctx.font = "12px Arial";
      const judges = [
        { label: "PERFECT", count: perfectCount, color: "#00ff88" },
        { label: "GOOD",    count: goodCount,    color: "#ffea00" },
        { label: "BAD",     count: badCount,     color: "#ff8800" },
        { label: "MISS",    count: missCount,    color: "#ff4444" },
      ];
      const colW = 84;
      const startX = cx - (judges.length - 1) * colW / 2;
      judges.forEach((j, idx) => {
        const jx = startX + idx * colW;
        ctx.fillStyle = j.color;
        ctx.fillText(j.label, jx, cy + 116);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(j.count, jx, cy + 132);
      });

      // 안내
      ctx.font      = "13px Arial";
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.fillText("팝업 버튼: 재시작  |  SPACE: 종료", cx, cy + 165);
    }

    ctx.restore();
  }

  // ===== 유틸 =====
  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y,   x + w, y + r);
    c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h); c.quadraticCurveTo(x,   y + h, x,     y + h - r);
    c.lineTo(x, y + r); c.quadraticCurveTo(x,   y,   x + r, y);
    c.closePath();
  }

  function makeParticles(x, y, count) {
    const p = [];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 4;
      p.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 2.5,
               r: 1.5 + Math.random() * 3, a: 1 });
    }
    return p;
  }

  // ===== 노트 생성 =====
  function spawnNote(allowDouble = false) {
    // 화면 상단에 너무 가까운 레인 제외 (충돌 방지)
    const occupied = new Set();
    for (const n of notes) {
      if (n.y < NOTE_H * 5) occupied.add(n.lane);
    }
    const available = [0, 1, 2, 3].filter(l => !occupied.has(l));
    const pool = available.length > 0 ? available : [0, 1, 2, 3];

    if (allowDouble && pool.length >= 2) {
      const shuffled = [...pool].sort(() => Math.random() - 0.5);
      _spawnOne(shuffled[0]);
      _spawnOne(shuffled[1], false); // 더블 시 두 번째는 일반 노트
    } else {
      _spawnOne(pool[Math.floor(Math.random() * pool.length)]);
    }
  }

  function _spawnOne(lane, allowHold = true) {
    if (allowHold && Math.random() < HOLD_CHANCE) {
      const hl = HOLD_MIN_LEN + Math.random() * (HOLD_MAX_LEN - HOLD_MIN_LEN);
      notes.push({ lane, y: -NOTE_H, isHold: true, holdLength: hl, activated: false });
    } else {
      notes.push({ lane, y: -NOTE_H, isHold: false });
    }
  }

  // ===== 이펙트 생성 =====
  function createHitEffect(lane, text, color, big = false) {
    const x = getLaneX(lane);
    const hitY = getHitY();
    effects.push({
      type: "text", x, y: hitY - 62,
      text, color,
      fontSize: big ? 38 : 24,
      life: big ? 72 : 44,
      maxLife: big ? 72 : 44,
    });

    if (text !== "MISS" && text !== "BAD" && text !== "BREAK!" && text !== "EMPTY") {
      effects.push({
        type: "particle", x, y: hitY, color,
        particles: makeParticles(x, hitY, big ? 32 : 16),
        life: 44, maxLife: 44,
      });
    } else {
      effects.push({ type: "miss_bar", lane, life: 20, maxLife: 20 });
    }
  }

  function createMilestoneEffect(combo) {
    const msgs = { 50: "🔥 50!", 100: "⚡ 100!", 200: "🌟 200!", 300: "💥 300!" };
    if (!msgs[combo]) return;
    const hitY = getHitY();
    effects.push({
      type: "text", x: W / 2, y: hitY * 0.45,
      text: `${msgs[combo]} COMBO`, color: "#fff",
      fontSize: 32, life: 95, maxLife: 95,
    });
    effects.push({ type: "flash", color: "#fff", intensity: 0.22, life: 30, maxLife: 30 });
    playSound("milestone");
  }

  // ===== 판정 처리 =====
  function judge(lane) {
    if (!gameState.active || gameOverState) return;
    lanePress[lane] = 14;

    const hitY = getHitY();
    let closest = null, closestDist = Infinity;

    for (const note of notes) {
      if (note.lane !== lane) continue;
      if (note.isHold && note.activated) continue; // 이미 홀드 중인 건 건너뜀
      const dist = Math.abs(note.y - hitY);
      if (dist < closestDist) { closestDist = dist; closest = note; }
    }

    // 빈 레인 패널티 (노트 없는데 누름)
    if (!closest || closestDist > HIT_BAD + 20) {
      if (gameState.combo > 0) {
        gameState.combo = 0;
        effects.push({
          type: "text", x: getLaneX(lane), y: hitY - 58,
          text: "EMPTY", color: "#555555",
          fontSize: 18, life: 28, maxLife: 28,
        });
        updateUI();
      }
      return;
    }

    // ── 롱노트 헤드 활성화 ──
    if (closest.isHold && !closest.activated) {
      let text, color, snd;
      if (closestDist < HIT_PERFECT) {
        text = "HOLD!"; color = "#00ff88"; snd = "hold_start";
        gameState.combo++; perfectCount++;
        gameState.hp = Math.min(MAX_HP, gameState.hp + HP_RECOVER);
      } else if (closestDist < HIT_GOOD) {
        text = "HOLD~"; color = "#ffea00"; snd = "hold_start";
        gameState.combo++; goodCount++;
      } else {
        text = "BAD";   color = "#ff8800"; snd = "bad";
        gameState.combo = 0; badCount++;
        gameState.hp -= HP_BAD; shakeAmount = 5;
      }
      totalNotes++;
      closest.activated = true;
      gameState.score += 50 * getMultiplier();
      if (gameState.combo > gameState.maxCombo) gameState.maxCombo = gameState.combo;
      if ([50, 100, 200, 300].includes(gameState.combo)) createMilestoneEffect(gameState.combo);
      createHitEffect(lane, text, color);
      playSound(snd);
      updateUI(); checkGameOver();
      return;
    }

    // ── 일반 노트 판정 ──
    let text, color, score, snd;
    if (closestDist < HIT_PERFECT) {
      text = "PERFECT!"; color = "#00ff88"; score = 150; snd = "perfect";
      gameState.combo++; perfectCount++;
      gameState.hp = Math.min(MAX_HP, gameState.hp + HP_RECOVER);
    } else if (closestDist < HIT_GOOD) {
      text = "GOOD";     color = "#ffea00"; score = 75;  snd = "good";
      gameState.combo++; goodCount++;
    } else if (closestDist < HIT_BAD) {
      text = "BAD";      color = "#ff8800"; score = 25;  snd = "bad";
      gameState.combo = 0; badCount++;
      gameState.hp -= HP_BAD; shakeAmount = 5;
    } else {
      text = "MISS";     color = "#ff4444"; score = 0;   snd = "miss";
      gameState.combo = 0; missCount++;
      gameState.hp -= HP_MISS; shakeAmount = 10;
    }
    totalNotes++;
    playSound(snd);

    if (score > 0) {
      gameState.score += score * getMultiplier();
      if (gameState.combo > gameState.maxCombo) gameState.maxCombo = gameState.combo;
      if ([50, 100, 200, 300].includes(gameState.combo)) createMilestoneEffect(gameState.combo);
    }

    const isBigPerfect = text === "PERFECT!" && gameState.combo > 0 && gameState.combo % 10 === 0;
    createHitEffect(lane, text, color, isBigPerfect);

    const idx = notes.indexOf(closest);
    if (idx !== -1) notes.splice(idx, 1);

    updateUI(); checkGameOver();
  }

  // ── 키 릴리즈: 롱노트 처리 ──
  function handleKeyUp(lane) {
    keysHeld[lane] = false;
    lanePress[lane] = 0;

    for (let i = notes.length - 1; i >= 0; i--) {
      const note = notes[i];
      if (note.lane !== lane || !note.isHold || !note.activated) continue;

      // 테일이 얼마나 남았는지 계산
      const hitY     = getHitY();
      const tailY    = note.y - note.holdLength;
      const traveled = hitY - tailY;          // 테일이 판정선을 향해 온 거리
      const total    = note.holdLength;

      if (traveled < total * 0.50) {
        // 절반도 안 홀드 → BREAK!
        createHitEffect(lane, "BREAK!", "#ff2244");
        playSound("miss");
        gameState.combo = 0;
        gameState.hp -= HP_MISS / 2;
        missCount++; totalNotes++;
        shakeAmount = 7;
      } else {
        // 충분히 홀드 → GOOD
        createHitEffect(lane, "GOOD", "#ffea00");
        playSound("good");
        gameState.score += 40 * getMultiplier();
        goodCount++; totalNotes++;
      }
      notes.splice(i, 1);
      updateUI(); checkGameOver();
      break;
    }
  }

  function checkGameOver() {
    if (gameState.hp > 0 || gameOverState) return;
    gameState.hp = 0;
    gameOverState = true;
    gameState.active = false;
    shakeAmount = 22;
    if (gameState.score > window.__rhythmSessionHigh__)
      window.__rhythmSessionHigh__ = gameState.score;
    setStatus("💀 게임오버!");
    updateUI();
    // 랭크 빛 이펙트
    const rank = getRank(getAccuracy());
    effects.push({ type: "rank_shine", color: rank.c, life: 120, maxLife: 120 });
    effects.push({ type: "flash", color: rank.c, intensity: 0.30, life: 40, maxLife: 40 });
  }

  // ===== 메인 게임 루프 =====
  function gameLoop() {
    // 게임오버 상태: 흔들림/이펙트가 남아있으면 계속 렌더
    if (gameOverState) {
      render();
      if (shakeAmount > 0.4 || effects.length > 0) {
        animFrameId = requestAnimationFrame(gameLoop);
      } else {
        animFrameId = null;
        render(); // 최종 정적 게임오버 화면
      }
      return;
    }

    if (!gameState.active) {
      animFrameId = null;
      return;
    }

    const hitY  = getHitY();
    const speed = getNoteSpeed();

    // ── 노트 이동 ──
    for (let i = notes.length - 1; i >= 0; i--) {
      const note = notes[i];
      note.y += speed;

      if (note.isHold) {
        if (note.activated) {
          // 홀드 중: 키 떼면 keyup에서 처리, 여기선 혹시 남은 것만 정리
          if (!keysHeld[note.lane]) {
            notes.splice(i, 1); continue;
          }
          // 프레임당 점수
          gameState.score += HOLD_SCORE_PER_FRAME;
          // 테일이 판정선 통과 → 홀드 완료!
          // tailY = note.y - holdLength. tailY >= hitY 이면 완료
          if (note.y - note.holdLength >= hitY) {
            createHitEffect(note.lane, "PERFECT!", "#00ff88", true);
            effects.push({
              type: "hold_bar", lane: note.lane, color: LANE_COLORS[note.lane],
              life: 38, maxLife: 38,
            });
            playSound("hold_end");
            gameState.score += 200 * getMultiplier();
            gameState.combo++;
            perfectCount++; totalNotes++;
            if (gameState.combo > gameState.maxCombo) gameState.maxCombo = gameState.combo;
            if ([50, 100, 200, 300].includes(gameState.combo)) createMilestoneEffect(gameState.combo);
            notes.splice(i, 1);
            updateUI();
            continue;
          }
        } else {
          // 미활성화 롱노트 헤드가 판정선 완전 통과 → MISS
          if (note.y > hitY + HIT_BAD + 10) {
            createHitEffect(note.lane, "MISS", "#ff4444");
            playSound("miss");
            gameState.combo = 0; missCount++; totalNotes++;
            gameState.hp -= HP_MISS; shakeAmount = 10;
            notes.splice(i, 1);
            updateUI(); checkGameOver();
          }
        }
      } else {
        // 일반 노트 판정선 통과 → MISS
        if (note.y > hitY + HIT_GOOD + 10) {
          createHitEffect(note.lane, "MISS", "#ff4444");
          playSound("miss");
          gameState.combo = 0; missCount++; totalNotes++;
          gameState.hp -= HP_MISS; shakeAmount = 10;
          notes.splice(i, 1);
          updateUI(); checkGameOver();
        }
      }
    }

    // HP 위기 시 미세 흔들림
    if (gameState.hp < 25 && Math.random() < 0.06)
      shakeAmount = Math.max(shakeAmount, 2.5);

    render();
    animFrameId = requestAnimationFrame(gameLoop);
  }

  // ===== 이벤트 리스너 =====
  function setupEventListeners() {
    keydownHandler = (e) => {
      if (e.repeat) return;

      // 스페이스바 → 게임 완전 종료
      if (e.code === "Space") {
        e.preventDefault();
        e.stopPropagation();
        terminateGame();
        return;
      }

      // ESC → 숨기기/보이기 토글
      if (e.key === "Escape" || e.code === "Escape") {
        toggleGame();
        e.stopPropagation();
        return;
      }

      const idx = LANE_KEYS.indexOf(e.key.toLowerCase());
      if (idx !== -1) {
        keysHeld[idx] = true;
        if (gameState.active) judge(idx);
        else lanePress[idx] = 4;
      }
    };

    keyupHandler = (e) => {
      const idx = LANE_KEYS.indexOf(e.key.toLowerCase());
      if (idx !== -1) handleKeyUp(idx);
    };

    visibilityHandler = () => {
      if (document.hidden && gameState.active) pauseGame();
    };
    resizeHandler = onWindowResize;

    document.addEventListener("keydown", keydownHandler, true);
    document.addEventListener("keyup",   keyupHandler,   true);
    document.addEventListener("visibilitychange", visibilityHandler);
    window.addEventListener("resize", resizeHandler);
  }

  function removeEventListeners() {
    if (keydownHandler)    { document.removeEventListener("keydown", keydownHandler, true); keydownHandler = null; }
    if (keyupHandler)      { document.removeEventListener("keyup",   keyupHandler,   true); keyupHandler = null; }
    if (visibilityHandler) { document.removeEventListener("visibilitychange", visibilityHandler); visibilityHandler = null; }
    if (resizeHandler)     { window.removeEventListener("resize", resizeHandler); resizeHandler = null; }
  }

  // ===== 게임 제어 =====
  function pauseGame() {
    gameState.active = false;
    if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
    if (container) container.style.display = "none";
  }

  function resumeGame() {
    if (gameOverState) return;
    gameState.active = true;
    if (container) container.style.display = "block";
    if (!animFrameId) animFrameId = requestAnimationFrame(gameLoop);
  }

  // 게임 완전 종료 (스페이스바)
  function terminateGame() {
    cleanupGame();
    window.__RHYTHM_GAME_LOADED__ = false;
    console.log("[Overlay] 게임 종료됨 (Space)");
  }

  // 재시작 (팝업 버튼)
  function resetGame() {
    Object.assign(gameState, { score: 0, combo: 0, maxCombo: 0, hp: MAX_HP, active: true });
    gameOverState = false;
    notes = []; effects = [];
    keysHeld    = [false, false, false, false];
    lanePress   = [0, 0, 0, 0];
    perfectCount = goodCount = badCount = missCount = totalNotes = 0;
    shakeAmount = beatPulse = 0;
    updateUI();
    setStatus("🎵 오디오 연결 대기 중...");
    if (!animFrameId) animFrameId = requestAnimationFrame(gameLoop);
  }

  window.toggleGame = function () {
    if (gameOverState) {
      if (container)
        container.style.display = container.style.display === "none" ? "block" : "none";
      return;
    }
    if (gameState.active) pauseGame(); else resumeGame();
  };
  window.resetRhythmGame = resetGame;

  function onWindowResize() {
    H = window.innerHeight;
    if (canvas)    { canvas.height = H; canvas.style.height = H + "px"; }
    if (container) container.style.height = H + "px";
    positionKeyGuide();
  }

  // ===== content.js 연동 =====
  window.__rhythmSpawnNote__ = () => { if (gameState.active) spawnNote(false); };
  window.__rhythmSetStatus__ = (msg) => setStatus(msg);

  // ===== 오디오 캡처 =====
  function startAudioCapture(streamId) {
    if (!streamId) { tryMicrophone(); return; }
    const timeout = new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 3000));
    Promise.race([
      navigator.mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
        video: false,
      }),
      timeout,
    ]).then(connectAudioStream).catch(() => {
      console.log("[Overlay] tabCapture 실패 → 마이크 시도");
      tryMicrophone();
    });
  }

  function tryMicrophone() {
    setStatus("🎤 마이크 연결 중...");
    navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    }).then(stream => {
      setStatus("🎤 마이크 감지 중 (음악을 틀어주세요)");
      connectAudioStream(stream);
    }).catch(err => {
      console.warn("[Overlay] 마이크 실패:", err.message);
      setStatus("⚠️ 오디오 연결 실패 — 탭 오디오를 확인하세요");
    });
  }

  function connectAudioStream(stream) {
    audioCtx = new AudioContext();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.55;
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    audioCtx.createMediaStreamSource(stream).connect(analyser);
    beatDetecting = true;
    setStatus("✅ 오디오 연결됨 — 비트 감지 중");
    detectBeat();
  }

  function detectBeat() {
    if (!beatDetecting || !analyser) return;
    analyser.getByteFrequencyData(dataArray);

    const bass   = dataArray.slice(0, 8).reduce((a, b) => a + b, 0) / 8;
    const lowMid = dataArray.slice(20, 60).reduce((a, b) => a + b, 0) / 40;
    const mid    = dataArray.slice(60, 100).reduce((a, b) => a + b, 0) / 40;
    const high   = dataArray.slice(100, 150).reduce((a, b) => a + b, 0) / 50;
    const energy = bass * 0.70 + lowMid * 0.20 + mid * 0.08 + high * 0.02;
    const now    = audioCtx.currentTime;

    if (energy > BEAT_THRESHOLD && now - lastBeatTime > BEAT_COOLDOWN) {
      lastBeatTime = now;
      if (gameState.active) {
        const isDouble = energy > BEAT_THRESHOLD * 1.6 && Math.random() < 0.35;
        spawnNote(isDouble);
        beatPulse = Math.min(1.0, energy / (BEAT_THRESHOLD * 2));
      }
    }
    requestAnimationFrame(detectBeat);
  }

  // ===== 정리 =====
  function cleanupGame() {
    if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
    beatDetecting = false;
    if (audioCtx) { audioCtx.close(); audioCtx = analyser = dataArray = null; }
    if (sfxCtx)   { sfxCtx.close(); sfxCtx = null; }
    notes = []; effects = [];
    removeEventListeners();
    if (container) { container.remove(); container = canvas = ctx = uiContainer = null; }
  }

  // ===== 초기화 =====
  function initGame() {
    createOverlay();
    setupEventListeners();
    gameState.active = true;
    gameOverState    = false;
    animFrameId = requestAnimationFrame(gameLoop);
    // 오디오 연결 시작 (streamId는 content.js에서 전달받음)
    startAudioCapture(null);
    updateUI();
    console.log("[Overlay] v3.1 initialized ✅");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initGame);
  } else {
    initGame();
  }
  window.addEventListener("unload", cleanupGame);
}

// ===== content.js → MAIN world 메시지 수신 =====
window.addEventListener("message", (event) => {
  if (!event.data || typeof event.data !== "object" || !event.data.type) return;
  const { type } = event.data;
  if (type === "RHYTHM_TOGGLE"    && window.toggleGame)          window.toggleGame();
  if (type === "RHYTHM_BEAT"      && window.__rhythmSpawnNote__)  window.__rhythmSpawnNote__();
  if (type === "RHYTHM_STATUS"    && window.__rhythmSetStatus__)  window.__rhythmSetStatus__(event.data.msg);
  if (type === "RHYTHM_STREAM_ID") startAudioCapture(event.data.streamId);
});
