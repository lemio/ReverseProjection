window.PongExample = (function() {
  let canvas, ctx, animFrame;
  let batY = 0.5;
  let aiBatY = 0.5;
  let ball = { x: 0.5, y: 0.5, vx: 0.007, vy: 0.005 };
  let score = { player: 0, ai: 0 };
  const BAT_HEIGHT = 0.15;
  const BAT_WIDTH  = 0.02;
  const BALL_SIZE  = 0.02;

  function init(panelEl) {
    panelEl.innerHTML = '<canvas id="pong-canvas" style="display:block;width:100%;height:100%;"></canvas>';
    canvas = document.getElementById('pong-canvas');
    canvas.width  = panelEl.offsetWidth  || 400;
    canvas.height = panelEl.offsetHeight || 500;
    ctx = canvas.getContext('2d');
    score = { player: 0, ai: 0 };
    ball = { x: 0.5, y: 0.5, vx: 0.007, vy: 0.005 };
    batY = 0.5; aiBatY = 0.5;
    if (animFrame) cancelAnimationFrame(animFrame);
    gameLoop();
  }

  function onPhonePosition(normalizedX, normalizedY) {
    batY = Math.max(BAT_HEIGHT / 2, Math.min(1 - BAT_HEIGHT / 2, normalizedY));
  }

  function gameLoop() {
    update();
    draw();
    animFrame = requestAnimationFrame(gameLoop);
  }

  function update() {
    ball.x += ball.vx;
    ball.y += ball.vy;

    if (ball.y < 0) { ball.y = 0;  ball.vy =  Math.abs(ball.vy); }
    if (ball.y > 1) { ball.y = 1;  ball.vy = -Math.abs(ball.vy); }

    // AI tracks ball
    aiBatY += (ball.y - aiBatY) * 0.05;
    aiBatY = Math.max(BAT_HEIGHT / 2, Math.min(1 - BAT_HEIGHT / 2, aiBatY));

    const MAX_V = 0.025;

    // Player bat collision (left)
    if (ball.x < BAT_WIDTH + BALL_SIZE && ball.vx < 0) {
      if (Math.abs(ball.y - batY) < BAT_HEIGHT / 2 + BALL_SIZE / 2) {
        ball.vx = Math.min(MAX_V,  Math.abs(ball.vx) * 1.05);
        ball.vy = Math.max(-MAX_V, Math.min(MAX_V, ball.vy + (ball.y - batY) * 0.04));
      }
    }
    // AI bat collision (right)
    if (ball.x > 1 - BAT_WIDTH - BALL_SIZE && ball.vx > 0) {
      if (Math.abs(ball.y - aiBatY) < BAT_HEIGHT / 2 + BALL_SIZE / 2) {
        ball.vx = -Math.min(MAX_V, Math.abs(ball.vx) * 1.05);
        ball.vy = Math.max(-MAX_V, Math.min(MAX_V, ball.vy + (ball.y - aiBatY) * 0.04));
      }
    }

    if (ball.x < 0) { score.ai++;     resetBall(); }
    if (ball.x > 1) { score.player++; resetBall(); }

    ball.vx = Math.max(-MAX_V, Math.min(MAX_V, ball.vx));
    ball.vy = Math.max(-MAX_V, Math.min(MAX_V, ball.vy));
  }

  function resetBall() {
    const dir = Math.random() > 0.5 ? 1 : -1;
    ball = { x: 0.5, y: 0.5, vx: dir * 0.007, vy: (Math.random() - 0.5) * 0.01 };
  }

  function draw() {
    if (!canvas || !ctx) return;
    const W = canvas.width, H = canvas.height;

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, W, H);

    // Centre dashed line
    ctx.strokeStyle = '#334';
    ctx.setLineDash([5, 10]);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
    ctx.setLineDash([]);

    // Player bat (left, red)
    ctx.fillStyle = '#e94560';
    const bh = BAT_HEIGHT * H;
    ctx.fillRect(0, (batY - BAT_HEIGHT / 2) * H, BAT_WIDTH * W, bh);

    // AI bat (right, blue)
    ctx.fillStyle = '#0f3460';
    ctx.fillRect((1 - BAT_WIDTH) * W, (aiBatY - BAT_HEIGHT / 2) * H, BAT_WIDTH * W, bh);

    // Ball
    ctx.fillStyle = '#e0e0e0';
    ctx.beginPath();
    ctx.arc(ball.x * W, ball.y * H, BALL_SIZE * Math.min(W, H) / 2, 0, Math.PI * 2);
    ctx.fill();

    // Score
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.floor(W * 0.08)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(score.player, W * 0.25, H * 0.1);
    ctx.fillText(score.ai,     W * 0.75, H * 0.1);

    ctx.font = `${Math.floor(W * 0.035)}px sans-serif`;
    ctx.fillStyle = '#aaa';
    ctx.fillText('YOU', W * 0.1,  H * 0.97);
    ctx.fillText('AI',  W * 0.9,  H * 0.97);
  }

  function destroy() {
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
    canvas = null; ctx = null;
  }

  function getState() {
    return { type: 'pong', detected: true, ball: { ...ball }, batY, aiBatY, score: { ...score } };
  }

  return { init, onPhonePosition, onDetectionChange: function() {}, destroy, getState };
})();
