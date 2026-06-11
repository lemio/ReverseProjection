window.ScreenExample = (function() {
  var panel = null;
  var socket = null;

  var stageEl = null;
  var videoEl = null;
  var overlaySvg = null;
  var animFrame = null;
  var statusEl = null;
  var startBtn = null;
  var stopBtn = null;

  var captureStream = null;
  var peer = null;
  var remoteSocketId = null;
  var latestMarkerInfos = {};
  var rotationEnabled = false;
  var previewZoom = 2.2;

  var PHONE_COLORS = ['#4d7cfe', '#e94560', '#f59e0b', '#34d399', '#a78bfa'];

  var rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' }
    ]
  };

  function hexToRgba(hex, alpha) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
    console.log('[ScreenExample]', text);
  }

  function init(panelEl, ioSocket, connectedPhones) {
    panel = panelEl;
    socket = ioSocket;
    latestMarkerInfos = {};
    remoteSocketId = null;
    captureStream = null;
    peer = null;

    // Immediately pick up any already-connected phone socket ID
    if (connectedPhones) {
      var ids = Object.keys(connectedPhones);
      for (var i = 0; i < ids.length; i++) {
        var ph = connectedPhones[ids[i]];
        if (ph && ph.socketId) {
          remoteSocketId = ph.socketId;
          console.log('[ScreenExample] init: pre-set remoteSocketId =', remoteSocketId);
          break;
        }
      }
    }

    panel.innerHTML =
      '<div id="screen-capture-panel">' +
      '  <div id="screen-stage">' +
      '    <video id="screen-preview" autoplay playsinline muted></video>' +
      '    <svg id="screen-overlay" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none"></svg>' +
      '  </div>' +
      '  <div id="screen-controls">' +
      '    <button id="screen-start">Share Screen</button>' +
      '    <button id="screen-stop">Stop Sharing</button>' +
      '    <span id="screen-status">Ready</span>' +
      '  </div>' +
      '</div>';

    stageEl     = document.getElementById('screen-stage');
    videoEl     = document.getElementById('screen-preview');
    overlaySvg  = document.getElementById('screen-overlay');
    startBtn    = document.getElementById('screen-start');
    stopBtn     = document.getElementById('screen-stop');
    statusEl    = document.getElementById('screen-status');

    stopBtn.style.display = 'none';

    startBtn.addEventListener('click', startSharing);
    stopBtn.addEventListener('click', stopSharing);

    syncStageLayout();
    animFrame = requestAnimationFrame(renderOverlay);
  }

  // ── Overlay canvas (phone outlines drawn over screen preview) ─────────────
  function getStageMetrics() {
    if (!stageEl) return null;
    var stageW = stageEl.clientWidth || 1;
    var stageH = stageEl.clientHeight || 1;
    var videoW = videoEl && videoEl.videoWidth ? videoEl.videoWidth : 0;
    var videoH = videoEl && videoEl.videoHeight ? videoEl.videoHeight : 0;

    if (!videoW || !videoH) {
      return { x: 0, y: 0, width: stageW, height: stageH, videoW: 0, videoH: 0 };
    }

    var fit = Math.min(stageW / videoW, stageH / videoH);
    var width = Math.max(1, videoW * fit);
    var height = Math.max(1, videoH * fit);
    var x = (stageW - width) / 2;
    var y = (stageH - height) / 2;

    return { x: x, y: y, width: width, height: height, videoW: videoW, videoH: videoH };
  }

  function syncStageLayout() {
    if (!overlaySvg || !videoEl || !stageEl) return null;
    var metrics = getStageMetrics();
    if (!metrics) return null;

    videoEl.style.left = metrics.x.toFixed(1) + 'px';
    videoEl.style.top = metrics.y.toFixed(1) + 'px';
    videoEl.style.width = metrics.width.toFixed(1) + 'px';
    videoEl.style.height = metrics.height.toFixed(1) + 'px';
    overlaySvg.style.left = metrics.x.toFixed(1) + 'px';
    overlaySvg.style.top = metrics.y.toFixed(1) + 'px';
    overlaySvg.style.width = metrics.width.toFixed(1) + 'px';
    overlaySvg.style.height = metrics.height.toFixed(1) + 'px';
    overlaySvg.setAttribute('viewBox', '0 0 ' + metrics.videoW + ' ' + metrics.videoH);
    return metrics;
  }

  function getSourceViewport(info, metrics) {
    var phoneW = Math.max(1, info.drawAreaW || 414);
    var phoneH = Math.max(1, info.drawAreaH || 578);
    var videoW = Math.max(1, metrics.videoW || 1);
    var videoH = Math.max(1, metrics.videoH || 1);
    var zoom = previewZoom;

    var nx = Math.max(0, Math.min(1, info.nx != null ? info.nx : 0.5));
    var ny = Math.max(0, Math.min(1, info.ny != null ? info.ny : 0.5));

    var baseScale = Math.max(phoneW / videoW, phoneH / videoH);
    var totalScale = baseScale * zoom;
    var scaledW = videoW * totalScale;
    var scaledH = videoH * totalScale;
    var tx = phoneW / 2 - nx * scaledW;
    var ty = phoneH / 2 - ny * scaledH;
    var minTx = phoneW - scaledW;
    var minTy = phoneH - scaledH;
    tx = Math.max(minTx, Math.min(0, tx));
    ty = Math.max(minTy, Math.min(0, ty));

    return {
      left: (-tx) / totalScale,
      top: (-ty) / totalScale,
      width: phoneW / totalScale,
      height: phoneH / totalScale,
      cx: ((-tx) / totalScale) + (phoneW / totalScale) / 2,
      cy: ((-ty) / totalScale) + (phoneH / totalScale) / 2
    };
  }

  function renderOverlay() {
    animFrame = requestAnimationFrame(renderOverlay);
    if (!overlaySvg) return;
    var metrics = syncStageLayout();
    overlaySvg.innerHTML = '';
    if (!metrics || !metrics.videoW || !metrics.videoH) return;

    var ids = Object.keys(latestMarkerInfos);
    if (!ids.length) return;

    ids.forEach(function(idStr) {
      var info  = latestMarkerInfos[idStr];
      var color = PHONE_COLORS[info.id % PHONE_COLORS.length];
      var viewport = getSourceViewport(info, metrics);
      var halfW = viewport.width / 2;
      var halfH = viewport.height / 2;
      var rot = rotationEnabled ? (info.rotation || 0) : 0;
      var cos = Math.cos(rot), sin = Math.sin(rot);

      var local = [
        [-halfW, -halfH], [ halfW, -halfH],
        [ halfW,  halfH], [-halfW,  halfH]
      ];
      var corners = local.map(function(c) {
        return {
          x: viewport.cx + c[0] * cos - c[1] * sin,
          y: viewport.cy + c[0] * sin + c[1] * cos
        };
      });

      var polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      polygon.setAttribute('points', corners.map(function(c) {
        return c.x.toFixed(2) + ',' + c.y.toFixed(2);
      }).join(' '));
      polygon.setAttribute('fill', hexToRgba(color, 0.08));
      polygon.setAttribute('stroke', color);
      polygon.setAttribute('stroke-width', '2');
      polygon.setAttribute('stroke-dasharray', '8 4');
      overlaySvg.appendChild(polygon);

      var label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', (corners[1].x + 6).toFixed(2));
      label.setAttribute('y', (corners[1].y + 4).toFixed(2));
      label.setAttribute('fill', color);
      label.setAttribute('font-size', '11');
      label.setAttribute('font-family', 'monospace');
      label.setAttribute('font-weight', '700');
      label.textContent = 'Phone ' + info.id;
      overlaySvg.appendChild(label);
    });
  }

  function onAllMarkersPosition(infos) {
    latestMarkerInfos = infos || {};
  }

  // ── Device status ─────────────────────────────────────────────────────────
  function onDeviceStatus(data) {
    if (!data || data.type !== 'phone') return;
    if (data.connected && data.socketId && !remoteSocketId) {
      remoteSocketId = data.socketId;
      console.log('[ScreenExample] onDeviceStatus: remoteSocketId =', remoteSocketId);
      if (captureStream) createOffer();
    } else if (!data.connected && data.socketId === remoteSocketId) {
      remoteSocketId = null;
      if (peer) { try { peer.close(); } catch (e) {} peer = null; }
      setStatus('Phone disconnected');
    }
  }

  // ── WebRTC signaling ──────────────────────────────────────────────────────
  function onWebrtcReady(data) {
    if (!data || data.type !== 'phone' || !data.socketId) return;
    remoteSocketId = data.socketId;
    console.log('[ScreenExample] webrtc:ready from', remoteSocketId);
    if (!captureStream) { setStatus('Ready'); return; }
    // Only create a new offer when there is no peer actively negotiating.
    // Checking signalingState guards against the phone heartbeat loop thrashing
    // peers that are mid-handshake (have-local-offer = waiting for answer).
    var busy = peer &&
      peer.signalingState !== 'closed' &&
      peer.connectionState !== 'failed' &&
      peer.connectionState !== 'closed';
    if (busy) {
      console.log('[ScreenExample] webrtc:ready – peer already active (' +
        peer.signalingState + ' / ' + peer.connectionState + '), skipping offer');
      return;
    }
    createOffer();
  }

  function onWebrtcSignal(data) {
    if (!data || data.type !== 'screen') return;

    if (data.kind === 'answer' && data.sdp) {
      if (!peer) return;
      // Learn the phone's socket ID from the answer's 'from' field (added by server)
      if (data.from && !remoteSocketId) {
        remoteSocketId = data.from;
        console.log('[ScreenExample] learned remoteSocketId from answer:', remoteSocketId);
      }
      peer.setRemoteDescription(new RTCSessionDescription(data.sdp))
        .then(function() { setStatus('Streaming'); })
        .catch(function(err) {
          console.error('[ScreenExample] setRemoteDescription failed:', err);
          setStatus('Connection failed – retry');
        });
      return;
    }

    if (data.kind === 'candidate' && data.candidate) {
      if (!peer) return;
      peer.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(function(err) {
        console.warn('[ScreenExample] addIceCandidate failed:', err);
      });
    }
  }

  // ── Peer management ───────────────────────────────────────────────────────
  function closePeer() {
    if (peer) { try { peer.close(); } catch (e) {} peer = null; }
  }

  function sendSignal(payload) {
    // Attach target socket ID when known; server broadcasts to room otherwise
    if (remoteSocketId) payload.to = remoteSocketId;
    socket.emit('webrtc:signal', payload);
  }

  function createOffer() {
    if (!socket || !captureStream) {
      console.warn('[ScreenExample] createOffer skipped — no socket or stream');
      return;
    }

    if (!remoteSocketId) {
      console.warn('[ScreenExample] createOffer: remoteSocketId unknown, will broadcast offer to room');
    }

    // Always start with a fresh peer for a clean offer
    closePeer();
    peer = new RTCPeerConnection(rtcConfig);

    peer.onicecandidate = function(ev) {
      if (!ev.candidate || !socket) return;
      sendSignal({ type: 'screen', kind: 'candidate', candidate: ev.candidate });
    };

    peer.onconnectionstatechange = function() {
      if (!peer) return;
      var s = peer.connectionState;
      if (s === 'connected')    setStatus('Streaming');
      if (s === 'failed')       setStatus('Connection failed – stop and retry');
      if (s === 'disconnected') setStatus('Connection lost');
    };

    captureStream.getTracks().forEach(function(track) {
      peer.addTrack(track, captureStream);
      track.onended = stopSharing;
    });

    peer.createOffer()
      .then(function(offer) { return peer.setLocalDescription(offer); })
      .then(function() {
        sendSignal({ type: 'screen', kind: 'offer', sdp: peer.localDescription });
        setStatus(remoteSocketId ? 'Offer sent…' : 'Offer broadcast – waiting for phone…');
        console.log('[ScreenExample] offer sent, remoteSocketId =', remoteSocketId);
      })
      .catch(function(err) {
        console.error('[ScreenExample] createOffer failed:', err);
        setStatus('Offer failed');
      });
  }

  // ── Sharing controls ──────────────────────────────────────────────────────
  function startSharing() {
    navigator.mediaDevices.getDisplayMedia({
      video: { cursor: 'always', frameRate: { ideal: 30, max: 60 } },
      audio: false
    }).then(function(stream) {
      captureStream = stream;
      videoEl.srcObject = stream;
      startBtn.style.display = 'none';
      stopBtn.style.display = '';
      setStatus('Screen captured');
      createOffer();
    }).catch(function(err) {
      console.error('[ScreenExample] getDisplayMedia failed:', err);
      setStatus('Capture denied or cancelled');
    });
  }

  function stopSharing() {
    if (captureStream) {
      captureStream.getTracks().forEach(function(t) { t.stop(); });
      captureStream = null;
    }
    if (videoEl) videoEl.srcObject = null;
    closePeer();
    if (socket && remoteSocketId) {
      socket.emit('webrtc:stream-state', { type: 'screen', active: false, to: remoteSocketId });
    }
    if (startBtn) startBtn.style.display = '';
    if (stopBtn)  stopBtn.style.display  = 'none';
    setStatus('Ready');
  }

  function getState() {
    var phones = {};
    var ids = Object.keys(latestMarkerInfos || {});
    ids.forEach(function(idStr) {
      var info = latestMarkerInfos[idStr];
      if (!info) return;
      phones[idStr] = {
        nx: Math.max(0, Math.min(1, info.nx || 0.5)),
        ny: Math.max(0, Math.min(1, info.ny || 0.5)),
        zoom: previewZoom,
        rotation: rotationEnabled ? (info.rotation || 0) : 0
      };
    });

    return {
      type: 'screen',
      detected: ids.length > 0,
      streaming: !!captureStream,
      phones: phones
    };
  }

  function setRotationEnabled(enabled) {
    rotationEnabled = !!enabled;
  }

  function destroy() {
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
    if (startBtn) startBtn.removeEventListener('click', startSharing);
    if (stopBtn)  stopBtn.removeEventListener('click', stopSharing);
    stopSharing();
    panel = null; videoEl = null; overlaySvg = null;
    startBtn = null; stopBtn = null; statusEl = null;
    latestMarkerInfos = {};
    stageEl = null;
  }

  return {
    init: init,
    destroy: destroy,
    getState: getState,
    onDeviceStatus: onDeviceStatus,
    onWebrtcReady: onWebrtcReady,
    onWebrtcSignal: onWebrtcSignal,
    onAllMarkersPosition: onAllMarkersPosition,
    setRotationEnabled: setRotationEnabled
  };
})();
