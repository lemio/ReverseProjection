# ReverseProjection

A web application that uses a webcam to detect a phone screen and overlay interactive content on top of it — in real time.

## How It Works

1. The **phone** displays four ArUco fiducial markers (ARUCO 5×5 dictionary, IDs 0 / 42 / 85 / 127) at its corners so it can be reliably detected by the webcam.
2. The **laptop** accesses the webcam, detects the four ArUco markers using `js-aruco2`, computes the phone's position and rotation, and draws a live overlay on the webcam feed.
3. Both devices communicate over WebSockets (Socket.io) through a local Node.js server.

```
Laptop webcam ──► AR.Detector (js-aruco2) ──► compute position/rotation
                                                │
                    ┌───────────────────────────┘
                    ▼
         Draw overlay on webcam feed
         Map camera position → lat/lng on Leaflet map
         Send map state / pong state to phone via WebSocket
                    │
                    ▼
              Phone receives state
              Shows matching UI (mini-map or pong)
              Sends touch events back (lat/lng or bat position)
```

## Examples

| Example | Phone controls | Phone screen shows |
|---------|---------------|--------------------|
| 🗺️ Map | Position → absolute geographic coordinate on the map | Leaflet mini-map zoomed in on phone's geographic position; draw strokes by touching |
| 🏓 Pong | Vertical position → bat height | Mirrored pong game with live score |

## Getting Started

```bash
npm install
npm start
# → http://localhost:3000   (laptop app)
# → http://localhost:3000/phone  (phone app)
```

### Connecting the phone

1. Open `http://localhost:3000` on the laptop.
2. The **Room Code** is shown in the header (e.g. `A3F9K2`).
3. Click **Copy Phone Link** — paste that URL into the phone's browser, or type the room code manually on the `/phone` page.
4. On the laptop, click **Start Webcam** and point it at the phone.

### Lighting tips

- The phone screen should face the webcam at a visible angle.
- Make sure the phone screen brightness is high — the ArUco markers need clear black/white contrast.
- If detection is unreliable, reduce glare and ambient reflections on the phone screen.
- When the phone is not found the corner markers automatically grow (110 px → 160 px) to aid re-acquisition.

## File Structure

```
server.js                        Node.js / Express / Socket.io server
public/
  index.html                     Laptop UI (webcam + overlay + example panel)
  css/style.css
  js/
    app.js                       Main orchestrator
    arucoDetector.js             Detects ArUco markers (IDs 0/42/85/127) → corner positions
    colorDetector.js             Legacy colour-centroid detector (not used in production)
    homography.js                Perspective-transform math (DLT algorithm)
    vendor/
      aruco-detector.js          Browser bundle of js-aruco2 (cv.js + aruco.js)
    examples/
      mapExample.js              Leaflet map — phone position → geographic coordinate
      pongExample.js             Pong game driven by phone Y position
  phone/
    index.html                   Phone PWA
    manifest.json
    sw.js                        Service worker (offline cache)
    css/phone.css
    js/
      phoneApp.js                Connection, example switching, searching-class toggle
      drawMarker.js              Renders ArUco marker patterns onto canvas
      examples/
        mapPhone.js              Leaflet mini-map tracking phone's geo-position; touch draws
        pongPhone.js             Mirrors game state from laptop
```
