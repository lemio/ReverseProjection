window.ScreenPhone = (function() {
  var videoEl = null;
  var hintEl = null;
  var peer = null;
  var sendFn = null;
  var currentLaptopSocketId = null;
  var readyInterval = null;   // heartbeat: re-send webrtc:ready until offer arrives
  var _markerId = 0;

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

    contentEl.innerHTML =
      '<div id="screen-phone-wrap" style="position:relative;flex:1;min-height:0;overflow:hidden;">' +
      '  <video id="screen-phone-video" autoplay playsinline muted ' +
      '    style="width:100%;height:100%;object-fit:cover;background:#000;display:block;"></video>' +
      '  <div id="screen-phone-hint" style="position:absolute;top:8px;left:8px;' +
      '    background:rgba(0,0,0,0.65);color:#e5e7eb;font-size:12px;padding:4px 8px;' +
      '    border-radius:4px;pointer-events:none;">Waiting for desktop stream</div>' +
      '</div>';

    videoEl = document.getElementById('screen-phone-video');
    hintEl  = document.getElementById('screen-phone-hint');

    startReadyHeartbeat();
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
    var wrap = videoEl.parentElement;
    if (!wrap) return;

    var visible = getVisibleSize(wrap);
    var w = visible.width || 1;
    var h = visible.height || 1;
    var videoW = videoEl.videoWidth || 1;
    var videoH = videoEl.videoHeight || 1;

    var nx = Math.max(0, Math.min(1, vp.nx != null ? vp.nx : 0.5));
    var ny = Math.max(0, Math.min(1, vp.ny != null ? vp.ny : 0.5));
    var z  = Math.max(1, Math.min(3.5, vp.zoom || 2.2));
    var rot = vp.rotation || 0;

    var baseScale = Math.max(w / videoW, h / videoH);
    var scaledW = videoW * baseScale * z;
    var scaledH = videoH * baseScale * z;
    var tx = w / 2 - nx * scaledW;
    var ty = h / 2 - ny * scaledH;

    var minTx = w - scaledW;
    var minTy = h - scaledH;
    tx = Math.max(minTx, Math.min(0, tx));
    ty = Math.max(minTy, Math.min(0, ty));

    videoEl.style.position = 'absolute';
    videoEl.style.left = tx.toFixed(1) + 'px';
    videoEl.style.top = ty.toFixed(1) + 'px';
    videoEl.style.width = scaledW.toFixed(1) + 'px';
    videoEl.style.height = scaledH.toFixed(1) + 'px';
    videoEl.style.transformOrigin = '50% 50%';
    videoEl.style.transform = rot ? ('rotate(' + (-rot).toFixed(4) + 'rad)') : '';
  }

  function onState(state) {
    if (!state || state.type !== 'screen') return;
    if (!state.streaming) return;

    var phones = state.phones || {};
    var myVp = phones[_markerId] || phones[String(_markerId)] || null;
    if (!myVp) return;

    applyViewportTransform(myVp);
  }

  function getViewportMetrics() {
    var wrap = document.getElementById('screen-phone-wrap');
    var visible = getVisibleSize(wrap);
    return { width: visible.width, height: visible.height };
  }

  function invalidate() {}

  function destroy() {
    stopReadyHeartbeat();
    if (peer) { try { peer.close(); } catch (e) {} peer = null; }
    currentLaptopSocketId = null;
    if (videoEl) videoEl.srcObject = null;
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
