window.ScreenPhone = (function() {
  var videoEl = null;
  var hintEl = null;
  var peer = null;
  var sendFn = null;
  var currentLaptopSocketId = null;
  var readyInterval = null;   // heartbeat: re-send webrtc:ready until offer arrives
  var _markerId = 0;

  // Marker scribbles drawn on top of the shared screen. Points are stored in
  // normalised source coordinates (0–1 of the unrotated source), so a mark
  // stays on the same spot of the shared screen however the source is rotated
  // and wherever the phone is pointing.
  var viewEl = null;
  var marksSvg = null;
  var strokes = [];
  var currentStroke = null;
  var pointerDown = false;
  var lastVp = null;
  var srcRotation = 0;
  var markColor = '#e94560';
  var lastEpoch = 0;

  var rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' }
    ]
  };

  function setHint(text) {
    if (hintEl) hintEl.textContent = text;
  }

  function stopReadyHeartbeat() {
    if (readyInterval) { clearInterval(readyInterval); readyInterval = null; }
  }

  function startReadyHeartbeat() {
    stopReadyHeartbeat();
    // Announce readiness immediately, then every 4 s until an offer arrives
    announceReady();
    readyInterval = setInterval(function() {
      if (!peer) announceReady();
      else stopReadyHeartbeat();
    }, 4000);
  }

  function announceReady() {
    if (!sendFn) return;
    console.log('[ScreenPhone] sending webrtc:ready');
    sendFn({ type: 'webrtc:ready', role: 'phone', markerId: _markerId });
  }

  function closePeer() {
    if (peer) { try { peer.close(); } catch (e) {} peer = null; }
    // Do NOT reset currentLaptopSocketId here — we still need it to send the answer
    // after calling closePeer() to get a fresh RTCPeerConnection for the new offer.
  }

  function ensurePeer() {
    if (peer && peer.signalingState !== 'closed') return peer;

    peer = new RTCPeerConnection(rtcConfig);

    peer.ontrack = function(ev) {
      if (!videoEl) return;
      var stream = ev.streams && ev.streams[0] ? ev.streams[0] : new MediaStream([ev.track]);
      videoEl.srcObject = stream;
      videoEl.play().catch(function() {});
      // Lay the stream out straight away; tracking refines it from the next state
      videoEl.addEventListener('loadedmetadata', ensureLayout);
      ensureLayout();
      setHint('');
      stopReadyHeartbeat();
    };

    peer.onicecandidate = function(ev) {
      if (!ev.candidate || !sendFn) return;
      var signal = { type: 'screen', kind: 'candidate', candidate: ev.candidate };
      if (currentLaptopSocketId) signal.to = currentLaptopSocketId;
      sendFn({ type: 'webrtc:signal', signal: signal });
    };

    peer.onconnectionstatechange = function() {
      if (!peer) return;
      var s = peer.connectionState;
      if (s === 'connected')    { setHint(''); stopReadyHeartbeat(); }
      if (s === 'failed')       { setHint('Connection failed'); startReadyHeartbeat(); }
      if (s === 'disconnected') { setHint('Stream lost'); startReadyHeartbeat(); }
    };

    return peer;
  }

  function getVisibleSize(el) {
    if (!el) return { width: 0, height: 0 };
    var rect = el.getBoundingClientRect();
    var visibleBottom = rect.bottom;
    var statusBar = document.getElementById('status-bar');
    if (statusBar) {
      visibleBottom = Math.min(visibleBottom, statusBar.getBoundingClientRect().top);
    }
    return {
      width: rect.width,
      height: Math.max(1, visibleBottom - rect.top)
    };
  }

  function init(contentEl, send, markerId) {
    sendFn   = send;
    _markerId = markerId || 0;
    stopReadyHeartbeat();
    closePeer();
    strokes = [];
    currentStroke = null;
    pointerDown = false;
    lastVp = null;

    contentEl.innerHTML =
      '<div id="screen-phone-wrap" style="position:relative;flex:1;min-height:0;overflow:hidden;touch-action:none;">' +
      '  <div id="screen-phone-view" style="position:absolute;left:0;top:0;transform-origin:50% 50%;">' +
      '    <video id="screen-phone-video" autoplay playsinline muted ' +
      '      style="position:absolute;transform-origin:50% 50%;background:#000;display:block;"></video>' +
      '    <svg id="screen-phone-marks" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" ' +
      '      style="position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;"></svg>' +
      '  </div>' +
      '  <div id="screen-phone-hint" style="position:absolute;top:8px;left:8px;' +
      '    background:rgba(0,0,0,0.65);color:#e5e7eb;font-size:12px;padding:4px 8px;' +
      '    border-radius:4px;pointer-events:none;">Waiting for desktop stream</div>' +
      '</div>';

    videoEl  = document.getElementById('screen-phone-video');
    viewEl   = document.getElementById('screen-phone-view');
    marksSvg = document.getElementById('screen-phone-marks');
    hintEl   = document.getElementById('screen-phone-hint');

    var wrap = document.getElementById('screen-phone-wrap');
    wrap.addEventListener('pointerdown', onPointerDown);
    wrap.addEventListener('pointermove', onPointerMove);
    wrap.addEventListener('pointerup', onPointerUp);
    wrap.addEventListener('pointercancel', onPointerUp);

    startReadyHeartbeat();
  }

  // Lay out with whatever we know; before the laptop tracks this phone that is
  // the middle of the source at zoom 1.
  function ensureLayout() {
    applyViewportTransform(lastVp || { nx: 0.5, ny: 0.5, zoom: 1, rotation: 0 });
  }

  /* ── Marker drawing ──────────────────────────────────────────────────── */
  // Screen point → normalised source coordinates, via the marks layer's own
  // coordinate system (it carries the same transforms as the video).
  function clientToSource(clientX, clientY) {
    if (!marksSvg || !videoEl) return null;
    var ctm = marksSvg.getScreenCTM();
    if (!ctm) return null;
    var p = marksSvg.createSVGPoint();
    p.x = clientX; p.y = clientY;
    var r = p.matrixTransform(ctm.inverse());   // rotated-space source px
    var srcW = videoEl.videoWidth || 1, srcH = videoEl.videoHeight || 1;
    var src = SourceRotate.fromRotated(srcRotation, r.x, r.y, srcW, srcH);
    return { u: Math.max(0, Math.min(1, src.x / srcW)), v: Math.max(0, Math.min(1, src.y / srcH)) };
  }

  function renderMarks() {
    if (!marksSvg || !videoEl) return;
    var srcW = videoEl.videoWidth || 1, srcH = videoEl.videoHeight || 1;
    var dims = SourceRotate.dims(srcRotation, srcW, srcH);
    marksSvg.setAttribute('viewBox', '0 0 ' + dims.w + ' ' + dims.h);
    var width = Math.max(3, dims.w * 0.012);
    var out = '';
    strokes.forEach(function(stroke) {
      if (!stroke.length) return;
      var pts = stroke.map(function(p) {
        var r = SourceRotate.toRotated(srcRotation, p.u * srcW, p.v * srcH, srcW, srcH);
        return r.x.toFixed(1) + ',' + r.y.toFixed(1);
      }).join(' ');
      out += '<polyline points="' + pts + '" fill="none" stroke="' + markColor +
        '" stroke-opacity="0.4" stroke-width="' + width.toFixed(1) +
        '" stroke-linecap="round" stroke-linejoin="round"/>';
    });
    marksSvg.innerHTML = out;
  }

  function sendMark(type, pt) {
    if (!sendFn) return;
    var msg = { kind: 'screen-mark', type: type, markerId: _markerId };
    if (pt) { msg.u = pt.u; msg.v = pt.v; }
    sendFn(msg);
  }

  function onPointerDown(e) {
    if (!videoEl || !videoEl.videoWidth) return;
    var pt = clientToSource(e.clientX, e.clientY);
    if (!pt) return;
    e.preventDefault();
    pointerDown = true;   // freezes the view until the finger lifts
    currentStroke = [pt];
    strokes.push(currentStroke);
    if (strokes.length > 200) strokes.shift();
    renderMarks();
    sendMark('start', pt);
  }

  function onPointerMove(e) {
    if (!pointerDown || !currentStroke) return;
    var pt = clientToSource(e.clientX, e.clientY);
    if (!pt) return;
    e.preventDefault();
    currentStroke.push(pt);
    renderMarks();
    sendMark('move', pt);
  }

  function onPointerUp() {
    if (!pointerDown) return;
    pointerDown = false;
    currentStroke = null;
    sendMark('end');
    if (lastVp) applyViewportTransform(lastVp);   // catch up with the tracking
  }

  function reannounce() {
    console.log('[ScreenPhone] reannounce');
    closePeer();
    startReadyHeartbeat();
  }

  function onWebrtcSignal(data) {
    if (!data || data.type !== 'screen') return;

    if (data.kind === 'offer' && data.sdp) {
      currentLaptopSocketId = data.from || currentLaptopSocketId;

      // Fresh peer for each incoming offer
      closePeer();
      var pc = ensurePeer();

      setHint('Connecting…');
      stopReadyHeartbeat();

      pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
        .then(function() { return pc.createAnswer(); })
        .then(function(answer) { return pc.setLocalDescription(answer); })
        .then(function() {
          if (!sendFn || !currentLaptopSocketId) return;
          sendFn({
            type: 'webrtc:signal',
            signal: {
              type: 'screen', kind: 'answer',
              sdp: pc.localDescription,
              to: currentLaptopSocketId
            }
          });
        })
        .catch(function(err) {
          console.error('[ScreenPhone] offer handling failed:', err);
          setHint('Connection failed – retrying');
          startReadyHeartbeat();
        });
      return;
    }

    if (data.kind === 'candidate' && data.candidate) {
      if (!peer) return;
      peer.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(function(err) {
        console.warn('[ScreenPhone] addIceCandidate failed:', err);
      });
    }
  }

  function onStreamState(data) {
    if (!data || data.type !== 'screen') return;
    if (data.active === false) {
      if (videoEl) videoEl.srcObject = null;
      closePeer();
      setHint('Stream ended');
    }
  }

  function applyViewportTransform(vp) {
    if (!videoEl || !vp) return;
    if (pointerDown) return;   // frozen while marking, so ink lands under the finger
    var wrap = videoEl.parentElement && videoEl.parentElement.parentElement;
    if (!wrap) return;

    var visible = getVisibleSize(wrap);
    var w = visible.width || 1;
    var h = visible.height || 1;
    var srcW = videoEl.videoWidth || 1;
    var srcH = videoEl.videoHeight || 1;

    // Lay out in rotated space: the source as the phone should see it
    var dims = SourceRotate.dims(srcRotation, srcW, srcH);

    var nx = Math.max(0, Math.min(1, vp.nx != null ? vp.nx : 0.5));
    var ny = Math.max(0, Math.min(1, vp.ny != null ? vp.ny : 0.5));
    var z  = Math.max(1, Math.min(3.5, vp.zoom || 2.2));
    var rot = vp.rotation || 0;

    var scale = Math.max(w / dims.w, h / dims.h) * z;
    var scaledW = dims.w * scale;
    var scaledH = dims.h * scale;
    var tx = w / 2 - nx * scaledW;
    var ty = h / 2 - ny * scaledH;
    tx = Math.max(w - scaledW, Math.min(0, tx));
    ty = Math.max(h - scaledH, Math.min(0, ty));

    // The view box holds the rotated source; the <video> inside it is
    // unrotated and centred, then CSS-rotated by the source rotation.
    viewEl.style.left = tx.toFixed(1) + 'px';
    viewEl.style.top = ty.toFixed(1) + 'px';
    viewEl.style.width = scaledW.toFixed(1) + 'px';
    viewEl.style.height = scaledH.toFixed(1) + 'px';
    viewEl.style.transform = rot ? ('rotate(' + (-rot).toFixed(4) + 'rad)') : '';

    var vw = srcW * scale, vh = srcH * scale;
    videoEl.style.left = ((scaledW - vw) / 2).toFixed(1) + 'px';
    videoEl.style.top = ((scaledH - vh) / 2).toFixed(1) + 'px';
    videoEl.style.width = vw.toFixed(1) + 'px';
    videoEl.style.height = vh.toFixed(1) + 'px';
    videoEl.style.transform = srcRotation ? ('rotate(' + srcRotation + 'deg)') : '';

    renderMarks();
  }

  function onState(state) {
    if (!state || state.type !== 'screen') return;
    if (!state.streaming) return;

    var rotChanged = SourceRotate.norm(state.sourceRotation) !== srcRotation;
    srcRotation = SourceRotate.norm(state.sourceRotation);

    // The laptop cleared all marks
    if (state.markEpoch != null && state.markEpoch !== lastEpoch) {
      lastEpoch = state.markEpoch;
      strokes = [];
      currentStroke = null;
      renderMarks();
    }

    var phones = state.phones || {};
    var myVp = phones[_markerId] || phones[String(_markerId)] || null;
    if (!myVp) { if (rotChanged) onStreamRotationOnly(); return; }
    if (myVp.color) markColor = myVp.color;

    lastVp = myVp;
    applyViewportTransform(myVp);
    if (rotChanged) renderMarks();
  }

  function onStreamRotationOnly() {
    // Source rotated while this phone isn't tracked — keep the view sensible
    ensureLayout();
  }

  function getViewportMetrics() {
    var wrap = document.getElementById('screen-phone-wrap');
    var visible = getVisibleSize(wrap);
    return { width: visible.width, height: visible.height };
  }

  function invalidate() {}

  function destroy() {
    var wrap = document.getElementById('screen-phone-wrap');
    if (wrap) {
      wrap.removeEventListener('pointerdown', onPointerDown);
      wrap.removeEventListener('pointermove', onPointerMove);
      wrap.removeEventListener('pointerup', onPointerUp);
      wrap.removeEventListener('pointercancel', onPointerUp);
    }
    strokes = []; currentStroke = null; pointerDown = false;
    viewEl = null; marksSvg = null; lastVp = null;
    stopReadyHeartbeat();
    if (peer) { try { peer.close(); } catch (e) {} peer = null; }
    currentLaptopSocketId = null;
    if (videoEl) { videoEl.removeEventListener('loadedmetadata', ensureLayout); videoEl.srcObject = null; }
    videoEl   = null;
    hintEl    = null;
    sendFn    = null;
    _markerId = 0;
  }

  return {
    init: init,
    reannounce: reannounce,
    onWebrtcSignal: onWebrtcSignal,
    onStreamState: onStreamState,
    onState: onState,
    getViewportMetrics: getViewportMetrics,
    invalidate: invalidate,
    destroy: destroy
  };
})();
