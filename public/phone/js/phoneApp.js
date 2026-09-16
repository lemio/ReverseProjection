(function() {
  // ── Stable client ID (from localStorage) ─────────────────────────────────
  // This is generated once per device so the server can assign the same marker
  // ID across page refreshes, which prevents phantom markers from accumulating.
  var CLIENT_ID = window.RP_CLIENT_ID || 'unknown';

  // Marker ID is assigned by the server after registration.
  // Default 0 is only used until the server responds.
  var PHONE_MARKER_ID = 0;

  var socket = null;
  var currentExample = 'map';
  var examples = {
    map: window.MapPhone,
    tldraw: window.TldrawPhone,
    screen: window.ScreenPhone
  };
  var activePhoneExample = null;
  var stateCount = 0;
  var phoneScale = 1;

  var emitViewportTimer = null;
  function scheduleEmitViewport(delay) {
    clearTimeout(emitViewportTimer);
    emitViewportTimer = setTimeout(emitViewport, delay || 150);
  }

  function applyPhoneScale(scale, persist) {
    var n = parseFloat(scale);
    if (!isFinite(n)) return;
    n = Math.max(0.75, Math.min(1.4, n));
    phoneScale = n;
    // The slider now controls content zoom (how much the phone shows), not the
    // fiducial marker CSS size.  --phone-scale stays at 1 so the marker is stable.
    if (persist) {
      localStorage.setItem('rpPhoneScale', n.toFixed(2));
    }
  }

  var borderPx = 0;
  var screen0 = null;  // {pw, ph, angle, cssW, cssH}: physical (natural-orientation) size + current layout

  // ── Orientation ─────────────────────────────────────────────────────────
  // The phone may rotate between portrait and landscape; tldraw then lays out
  // natively with its UI upright. The tracking border must stay physically
  // the same on the device, so it is always drawn in the device's natural
  // (portrait) frame, rotated into the current CSS layout. The laptop gets the
  // physical size (for the image targets) plus where the CSS layout's corners
  // lie in that physical frame, so it can map the tldraw area correctly.

  // Rotation of the CSS layout relative to the natural orientation, in degrees
  // (90 = device turned counter-clockwise, as screen.orientation.angle / window.orientation).
  function layoutAngle() {
    var a = null;
    if (screen.orientation && typeof screen.orientation.angle === 'number') a = screen.orientation.angle;
    else if (typeof window.orientation === 'number') a = window.orientation;
    if (a == null) a = window.innerWidth > window.innerHeight ? 90 : 0;
    a = ((a % 360) + 360) % 360;
    // The angle and the viewport size can briefly disagree while rotating
    var landscape = window.innerWidth > window.innerHeight;
    if (landscape !== (a === 90 || a === 270)) a = landscape ? 90 : 0;
    return a;
  }

  // Physical (natural frame) point → CSS point, for the given layout angle
  function physToCss(angle, pw, ph) {
    switch (angle) {
      case 90:  return [0, -1, 1, 0, 0, pw];     // x' = v,      y' = pw - u
      case 180: return [-1, 0, 0, -1, pw, ph];   // x' = pw - u, y' = ph - v
      case 270: return [0, 1, -1, 0, ph, 0];     // x' = ph - v, y' = u
      default:  return [1, 0, 0, 1, 0, 0];
    }
  }

  // The visible area. visualViewport excludes anything overlaying the page
  // (Android's gesture bar coming back, the on-screen keyboard), so the border
  // is never drawn under it — a border drawn past the visible edge loses its
  // outer lane and the laptop tracks a screen size the phone doesn't show.
  function viewportSize() {
    var vv = window.visualViewport;
    if (!vv || !vv.width || !vv.height) return { w: window.innerWidth, h: window.innerHeight };
    return { w: Math.min(window.innerWidth, Math.round(vv.width)),
             h: Math.min(window.innerHeight, Math.round(vv.height)) };
  }

  // True while text is being edited — that shrink is the keyboard, and the
  // border must stay as it is so tracking isn't disturbed mid-edit.
  function editing() {
    var el = document.activeElement;
    return !!(el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'));
  }

  // Returns true when the layout or physical size changed (border redrawn).
  function updateScreen() {
    var vp = viewportSize(), cssW = vp.w, cssH = vp.h, angle = layoutAngle();
    var prev = screen0;
    if (prev && prev.angle === angle && prev.cssW === cssW && prev.cssH === cssH) return false;
    // Shorter while editing: the on-screen keyboard — keep the border as is.
    if (prev && prev.angle === angle && prev.cssW === cssW && cssH < prev.cssH && editing()) return false;
    var sideways = angle === 90 || angle === 270;
    screen0 = { angle: angle, cssW: cssW, cssH: cssH, pw: sideways ? cssH : cssW, ph: sideways ? cssW : cssH };
    redrawBorder();
    return true;
  }

  // Draw the dashed tracking border around the screen edge and inset the
  // content area by its thickness (the same on every side, so any layout works).
  function redrawBorder() {
    var canvas = document.getElementById('tracking-border');
    if (!canvas || !screen0) return;
    var dpr = window.devicePixelRatio || 1;
    canvas.style.width  = screen0.cssW + 'px';
    canvas.style.height = screen0.cssH + 'px';
    canvas.width  = Math.round(screen0.cssW * dpr);
    canvas.height = Math.round(screen0.cssH * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var m = physToCss(screen0.angle, screen0.pw, screen0.ph);
    ctx.setTransform(m[0] * dpr, m[1] * dpr, m[2] * dpr, m[3] * dpr, m[4] * dpr, m[5] * dpr);
    borderPx = BorderPattern.draw(ctx, screen0.pw, screen0.ph);
    document.documentElement.style.setProperty('--rp-border', borderPx + 'px');
  }

  // CSS layout corners (TL, TR, BR, BL) expressed in physical px
  function cssCornersInPhys() {
    var m = physToCss(screen0.angle, screen0.pw, screen0.ph);
    // invert the rotation+translation: u = a*(x-e) + b*(y-f), v = c*(x-e) + d*(y-f)
    return [[0, 0], [screen0.cssW, 0], [screen0.cssW, screen0.cssH], [0, screen0.cssH]].map(function(p) {
      var x = p[0] - m[4], y = p[1] - m[5];
      return { x: Math.round(m[0] * x + m[1] * y), y: Math.round(m[2] * x + m[3] * y) };
    });
  }

  // ── Fullscreen ──────────────────────────────────────────────────────────
  // A fullscreen phone has no browser chrome sliding in and out, so the
  // tracking border stays fully visible and the screen size stays put.
  // Android/desktop have the Fullscreen API; on iOS only the installed
  // home-screen app is fullscreen (manifest display: fullscreen).
  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function toggleFullscreen() {
    var el = document.documentElement;
    if (isFullscreen()) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      return;
    }
    var req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) {
      showToast('Add this page to your home screen for a fullscreen app');
      return;
    }
    var r = req.call(el, { navigationUI: 'hide' });
    if (r && r.catch) r.catch(function(err) { showToast('Fullscreen refused: ' + err.message); });
  }

  function setupFullscreen() {
    var btn = document.getElementById('fullscreen-btn');
    if (!btn) return;
    btn.addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', onResize);
    document.addEventListener('webkitfullscreenchange', onResize);
  }

  var toastTimer = null;
  function showToast(text, ms) {
    var el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      document.getElementById('phone-app').appendChild(el);
    }
    el.textContent = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function() { el.remove(); }, ms || 4000);
  }

  // Briefly show the CSS viewport size + DPR, needed to generate a matching
  // image target: node tools/generate-border-target.js --width W --height H --dpr D
  function showScreenSize() {
    var label = document.createElement('div');
    label.id = 'screen-size-label';
    label.textContent = screen0.pw + ' × ' + screen0.ph + ' @' + (window.devicePixelRatio || 1) + 'x';
    document.getElementById('phone-app').appendChild(label);
    setTimeout(function() { label.remove(); }, 6000);
  }

  // Emit viewport dimensions so the laptop can compute the correct scale.
  function emitViewport() {
    if (!socket || !screen0) return;
    var content = document.getElementById('example-content');
    var statusBar = document.getElementById('status-bar');
    var metrics = null;
    if (activePhoneExample && activePhoneExample.getViewportMetrics) {
      metrics = activePhoneExample.getViewportMetrics();
    }
    var drawAreaW = metrics && metrics.width ? metrics.width : (content ? (content.clientWidth || 375) : 375);
    var drawAreaH = metrics && metrics.height ? metrics.height : (content ? (content.clientHeight || 500) : 500);
    if (!metrics && statusBar && drawAreaH > statusBar.offsetHeight) {
      drawAreaH = Math.max(1, drawAreaH - statusBar.offsetHeight);
    }
    socket.emit('phone:viewport', {
      markerId:        PHONE_MARKER_ID,
      borderPx:        borderPx,
      screenW:         screen0.pw,        // physical (portrait) size → image targets
      screenH:         screen0.ph,
      cssW:            screen0.cssW,      // current layout
      cssH:            screen0.cssH,
      cssCorners:      cssCornersInPhys(),
      drawAreaW:       drawAreaW,         // in the current layout
      drawAreaH:       drawAreaH
    });
  }

  function connect() {
    socket = io();

    socket.on('connect', function() {
      stateCount = 0;
      // Send clientId so the server can give us a stable markerId
      socket.emit('device:register', { type: 'phone', clientId: CLIENT_ID });
    });

    // Server ack — contains the assigned markerId
    socket.on('device:registered', function(data) {
      var newId = (data && data.markerId != null) ? data.markerId : 0;
      var needsInit = !activePhoneExample || newId !== PHONE_MARKER_ID;
      PHONE_MARKER_ID = newId;
      console.log('[PhoneApp] Registered | clientId=' + CLIENT_ID + ' | markerId=' + PHONE_MARKER_ID);

      document.getElementById('connecting-screen').style.display = 'none';
      document.getElementById('example-area').style.display = 'flex';
      var indicator = document.getElementById('connection-indicator');
      indicator.className = 'connected';
      indicator.textContent = 'Live';

      // Init the example on first registration (or if our marker ID changed).
      // A plain reconnect keeps the running example: re-initialising would
      // reload tldraw ("Loading whiteboard…") every time the socket blips.
      if (needsInit) switchExample(currentExample);

      scheduleEmitViewport(200);

      // Request any existing tldraw state
      socket.emit('tldraw:init-request');
    });

    socket.on('disconnect', function(reason) {
      console.warn('[PhoneApp] socket disconnected: ' + reason);
      var indicator = document.getElementById('connection-indicator');
      indicator.className = '';
      indicator.textContent = 'Disconnected (' + reason + ')';
    });

    socket.on('config:change', function(data) {
      // Sent whenever a laptop (re)connects — make sure it knows our screen
      // size so it can load the matching image targets.
      scheduleEmitViewport(100);
      if (data && data.phoneScale != null) {
        applyPhoneScale(data.phoneScale, true);
      }
      if (data.example && data.example !== currentExample) {
        switchExample(data.example);
      } else if (data.example && data.example === 'screen' && currentExample === 'screen' && data.reannounce) {
        // Laptop refreshed / re-entered Screen mode — re-announce readiness
        if (activePhoneExample && activePhoneExample.reannounce) {
          activePhoneExample.reannounce();
        }
      }
    });

    socket.on('webrtc:signal', function(data) {
      if (activePhoneExample && activePhoneExample.onWebrtcSignal) {
        activePhoneExample.onWebrtcSignal(data);
      }
    });

    socket.on('webrtc:stream-state', function(data) {
      if (activePhoneExample && activePhoneExample.onStreamState) {
        activePhoneExample.onStreamState(data);
      }
    });

    socket.on('laptop:state', function(state) {
      stateCount++;
      if (stateCount % 30 === 1) {
        console.log('[PhoneApp] laptop:state #' + stateCount +
          ' | detected=' + (state && state.detected) +
          ' | type=' + (state && state.type));
      }

      if (activePhoneExample && activePhoneExample.onState) {
        activePhoneExample.onState(state);
      }

      // Toggle searching class for spinner visibility — no marker resize
      var phoneApp = document.getElementById('phone-app');
      var wasSearching = phoneApp.classList.contains('searching');
      var nowSearching = state && state.detected === false;
      if (nowSearching !== wasSearching) {
        phoneApp.classList.toggle('searching', nowSearching);
        console.log('[PhoneApp] searching ' + (nowSearching ? 'ON' : 'OFF'));
      }
    });

    // ── tldraw store sync ──────────────────────────────────────────────────
    socket.on('tldraw:diff', function(diff) {
      if (activePhoneExample && activePhoneExample.onTldrawDiff) {
        activePhoneExample.onTldrawDiff(diff);
      }
    });
    socket.on('tldraw:snapshot', function(snapshot) {
      if (activePhoneExample && activePhoneExample.onTldrawSnapshot) {
        activePhoneExample.onTldrawSnapshot(snapshot);
      }
    });
  }

  function switchExample(name) {
    currentExample = name;
    var displayNames = { map: 'Map', tldraw: 'Draw', screen: 'Screen' };
    document.getElementById('example-name').textContent = displayNames[name] || name;

    // tldraw-mode class adds extra top margin so the tldraw toolbar is accessible
    var phoneApp = document.getElementById('phone-app');
    phoneApp.classList.toggle('tldraw-mode', name === 'tldraw');

    if (activePhoneExample && activePhoneExample.destroy) {
      try { activePhoneExample.destroy(); } catch(e) {
        console.warn('[PhoneApp] destroy threw:', e);
      }
    }
    activePhoneExample = null;
    activePhoneExample = examples[name] || null;
    var contentEl = document.getElementById('example-content');
    if (activePhoneExample && activePhoneExample.init) {
      activePhoneExample.init(
        contentEl,
        function(data) {
          if (!socket) return;
          if (data && data.type === 'tldraw:diff') {
            socket.emit('tldraw:diff', data.diff);
          } else if (data && data.type === 'tldraw:snapshot') {
            socket.emit('tldraw:snapshot', data.snapshot);
          } else if (data && data.type === 'webrtc:ready') {
            socket.emit('webrtc:ready', {
              type: 'phone',
              markerId: PHONE_MARKER_ID,
              socketId: socket.id,
              role: data.role || 'phone'
            });
          } else if (data && data.type === 'webrtc:signal' && data.signal) {
            socket.emit('webrtc:signal', data.signal);
          } else {
            socket.emit('phone:touch', data);
          }
        },
        PHONE_MARKER_ID
      );
    }
    scheduleEmitViewport(300);
  }

  // Re-emit viewport when the layout or physical size really changed
  var resizeRechecks = [];
  function onResize() {
    if (updateScreen()) scheduleEmitViewport(200);
    // Re-check afterwards: orientation events can fire before innerWidth/
    // innerHeight are updated (notably on iOS), and entering fullscreen or a
    // system bar sliding back in can take a moment to settle (Android).
    resizeRechecks.forEach(clearTimeout);
    resizeRechecks = [400, 1500].map(function(ms) {
      return setTimeout(function() {
        if (updateScreen()) scheduleEmitViewport(200);
      }, ms);
    });
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  window.addEventListener('focusout', onResize);   // keyboard closing
  if (screen.orientation && screen.orientation.addEventListener) {
    screen.orientation.addEventListener('change', onResize);
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onResize);
  }

  updateScreen();
  setupFullscreen();
  showScreenSize();

  applyPhoneScale(parseFloat(localStorage.getItem('rpPhoneScale') || '1'), false);

  // Auto-connect immediately — no room code needed
  connect();
})();
