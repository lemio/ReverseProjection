window.MapPhone = (function() {
  var touchCanvas = null;
  var sendTouch = null;
  var isDrawing = false;
  var mouseDown = false;

  function init(el, sendFn) {
    sendTouch = sendFn;
    el.innerHTML = '<canvas id="phone-draw-canvas"></canvas><div class="map-hint">Draw on screen to draw on the map</div>';
    touchCanvas = document.getElementById('phone-draw-canvas');
    touchCanvas.width  = el.offsetWidth  || window.innerWidth;
    touchCanvas.height = el.offsetHeight || window.innerHeight;

    var ctx = touchCanvas.getContext('2d');
    ctx.strokeStyle = '#e94560';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';

    touchCanvas.addEventListener('touchstart', onTouchStart, { passive: false });
    touchCanvas.addEventListener('touchmove',  onTouchMove,  { passive: false });
    touchCanvas.addEventListener('touchend',   onTouchEnd,   { passive: false });
    touchCanvas.addEventListener('mousedown',  onMouseDown);
    touchCanvas.addEventListener('mousemove',  onMouseMove);
    touchCanvas.addEventListener('mouseup',    onMouseUp);
  }

  function getCoords(e, canvas) {
    var rect  = canvas.getBoundingClientRect();
    var touch = e.touches ? e.touches[0] : e;
    return {
      x: (touch.clientX - rect.left) / rect.width,
      y: (touch.clientY - rect.top)  / rect.height
    };
  }

  function onTouchStart(e) {
    e.preventDefault();
    isDrawing = true;
    var coords = getCoords(e, touchCanvas);
    sendTouch({ type: 'start', x: coords.x, y: coords.y });
  }

  function onTouchMove(e) {
    e.preventDefault();
    if (!isDrawing) return;
    var coords = getCoords(e, touchCanvas);
    sendTouch({ type: 'move', x: coords.x, y: coords.y });
  }

  function onTouchEnd(e) {
    e.preventDefault();
    isDrawing = false;
    sendTouch({ type: 'end', x: 0, y: 0 });
  }

  function onMouseDown(e) {
    mouseDown = true;
    var c = getCoords(e, touchCanvas);
    sendTouch({ type: 'start', x: c.x, y: c.y });
  }

  function onMouseMove(e) {
    if (!mouseDown) return;
    var c = getCoords(e, touchCanvas);
    sendTouch({ type: 'move', x: c.x, y: c.y });
  }

  function onMouseUp() {
    mouseDown = false;
    sendTouch({ type: 'end', x: 0, y: 0 });
  }

  function destroy() {
    if (touchCanvas) {
      touchCanvas.removeEventListener('touchstart', onTouchStart);
      touchCanvas.removeEventListener('touchmove',  onTouchMove);
      touchCanvas.removeEventListener('touchend',   onTouchEnd);
      touchCanvas.removeEventListener('mousedown',  onMouseDown);
      touchCanvas.removeEventListener('mousemove',  onMouseMove);
      touchCanvas.removeEventListener('mouseup',    onMouseUp);
    }
    touchCanvas = null;
    sendTouch   = null;
    isDrawing   = false;
    mouseDown   = false;
  }

  return { init, destroy };
})();
