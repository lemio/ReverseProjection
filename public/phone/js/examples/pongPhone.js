window.PongPhone = (function() {
  var canvas = null;
  var ctx = null;
  var currentState = null;
  var animFrame = null;

  function init(el, sendFn) {
    el.innerHTML = '<canvas id="pong-phone-canvas"></canvas><div class="pong-hint">Move phone vertically to control the bat</div>';
    canvas = document.getElementById('pong-phone-canvas');
    canvas.width  = el.offsetWidth  || window.innerWidth;
    canvas.height = el.offsetHeight || 300;
    ctx = canvas.getContext('2d');
    currentState = null;
    if (animFrame) cancelAnimationFrame(animFrame);
    drawLoop();
  }

  function drawLoop() {
    draw();
    animFrame = requestAnimationFrame(drawLoop);
  }

  function onState(state) {
    currentState = state;
  }

  function draw() {
    if (!canvas || !ctx) return;
    var W = canvas.width, H = canvas.height;

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, W, H);

    if (!currentState) {
      ctx.fillStyle = '#aaa';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for game state…', W / 2, H / 2);
      return;
    }

    var ball  = currentState.ball;
    var batY  = currentState.batY;
    var aiBatY = currentState.aiBatY;
    var score  = currentState.score;

    var BAT_H = 0.15 * H;
    var BAT_W = 0.03 * W;

    // Player bat (left, red)
    ctx.fillStyle = '#e94560';
    ctx.fillRect(0, (batY - 0.075) * H, BAT_W, BAT_H);

    // AI bat (right, blue)
    ctx.fillStyle = '#0f3460';
    ctx.fillRect(W - BAT_W, (aiBatY - 0.075) * H, BAT_W, BAT_H);

    // Ball
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(ball.x * W, ball.y * H, 8, 0, Math.PI * 2);
    ctx.fill();

    // Score
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(score.player + '  :  ' + score.ai, W / 2, 30);

    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#aaa';
    ctx.fillText('Move phone vertically to control bat', W / 2, H - 10);
  }

  function destroy() {
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
    canvas = null;
    ctx    = null;
    currentState = null;
  }

  return { init, onState, destroy };
})();
