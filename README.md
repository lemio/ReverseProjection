# ReverseProjection

A web application that uses a webcam to detect a phone screen and overlay interactive content on top of it — in real time.

## How It Works

1. The **phone** displays four large colored corner markers (red, green, blue, yellow) so it can be found by the webcam.
2. The **laptop** accesses the webcam, detects those colored corners with a colour-centroid algorithm, and draws a live overlay showing the phone's position and rotation.
3. Both devices communicate over WebSockets (Socket.io) through a local Node.js server.

```
Laptop webcam ──► detect phone corners ──► compute position/rotation
                                             │
                   ┌─────────────────────────┘
                   ▼
         Draw overlay on webcam feed
         Update active example with phone coords
         Send game state to phone via WebSocket
                   │
                   ▼
             Phone receives state
             Shows matching UI
             Sends touch events back
```

## Examples

| Example | Phone controls | Phone screen shows |
|---------|---------------|--------------------|
| 🗺️ Map | Position → pans the map (velocity-based) | Touch canvas — draw strokes on the map |
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
- Avoid backgrounds that have large red, green, blue or yellow areas near the phone.
- Make sure the phone screen brightness is high.

## File Structure

```
server.js                        Node.js / Express / Socket.io server
public/
  index.html                     Laptop UI (webcam + overlay + example panel)
  css/style.css
  js/
    app.js                       Main orchestrator
    colorDetector.js             Detects phone corners by colour
    homography.js                Perspective-transform math
    examples/
      mapExample.js              Leaflet map driven by phone position
      pongExample.js             Pong game driven by phone Y position
  phone/
    index.html                   Phone PWA
    manifest.json
    sw.js                        Service worker (offline cache)
    css/phone.css
    js/
      phoneApp.js                Connection, example switching
      examples/
        mapPhone.js              Touch canvas → draw events
        pongPhone.js             Mirrors game state from laptop
```
