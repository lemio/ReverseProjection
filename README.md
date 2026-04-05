# ReverseProjection

A live augmented-reality application that turns a webcam into a position sensor: hold your phone in front of the camera and an interactive map appears, perfectly aligned with your physical location. Touch the phone screen to draw annotations that appear on both the phone and the large display simultaneously.

Designed for museum and gallery installations — no accounts, no configuration, no room codes. Anyone who opens the phone page connects automatically.

---

## How It Works

1. The **phone** displays four ArUco fiducial markers (IDs 0 / 8 / 40 / 56) at its corners so the webcam can reliably detect it.
2. The **laptop** accesses the webcam, detects the four markers using jsartoolkit5, computes the phone's position and rotation, and draws a live overlay on the webcam feed.
3. Both devices communicate over WebSockets (Socket.io) through a local Node.js server running on your network.
4. The laptop map shows a bounding box representing the area currently visible on the phone's mini-map.
5. Touching the phone screen sends lat/lng coordinates back to the laptop and draws a stroke on both maps simultaneously.

---

## Getting Started

### Step 1 — Install Node.js

Node.js is the JavaScript runtime the server needs. Install it once; it stays on your machine.

**macOS**

The easiest way is Homebrew, a package manager for macOS. If you have never used it:

1. Open **Terminal** (press Command+Space, type "Terminal", press Enter).
2. Paste the following command and press Enter. It will ask for your Mac password:

   ```
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```

3. After Homebrew finishes, install Node.js:

   ```
   brew install node
   ```

4. Verify the installation:

   ```
   node --version
   ```

   You should see something like `v20.x.x`.

**Windows**

1. Open a web browser and go to [https://nodejs.org](https://nodejs.org).
2. Download the **LTS** installer (the button labelled "LTS" — Long Term Support).
3. Run the downloaded `.msi` file and follow the installer steps. Leave all options at their defaults.
4. When it finishes, open **Command Prompt** (press Windows+R, type `cmd`, press Enter) and verify:

   ```
   node --version
   ```

**Linux (Ubuntu / Debian)**

```
sudo apt update
sudo apt install nodejs npm
node --version
```

For other distributions, see [https://nodejs.org/en/download/package-manager](https://nodejs.org/en/download/package-manager).

---

### Step 2 — Download the project

If you have Git installed:

```
git clone https://github.com/lemio/ReverseProjection.git
cd ReverseProjection
```

If you do not have Git, download the ZIP from GitHub (click the green "Code" button, then "Download ZIP"), unzip it, and open a terminal inside the folder.

---

### Step 3 — Install dependencies and start the server

In your terminal, inside the project folder:

```
npm install
npm start
```

You should see:

```
ReverseProjection server running at http://localhost:3000
```

Leave this terminal window open — the server must keep running.

---

### Step 4 — Open the laptop app

Open a browser (Chrome or Edge recommended for best webcam support) and go to:

```
http://localhost:3000
```

Allow camera access when the browser asks. The webcam feed will appear.

---

### Step 5 — Connect a phone

The phone must be on the **same Wi-Fi network** as the laptop.

1. On the laptop, click **Copy Phone Link** in the toolbar. This copies the URL to your clipboard.
2. Open that URL on the phone's browser, or click **Show QR Code** and scan it with the phone camera.
3. The phone will connect automatically and display an interactive map.

To find your laptop's local IP address (for typing the URL manually):

- **macOS / Linux**: run `ifconfig | grep "inet "` in Terminal — look for a number like `192.168.x.x`
- **Windows**: run `ipconfig` in Command Prompt — look for "IPv4 Address"

Then open `http://192.168.x.x:3000/phone` on the phone.

---

## Using the Application

- Hold the phone face-up in front of the webcam. The four black-and-white markers at the corners allow the webcam to track position.
- The laptop map shows a blue rectangle representing the area currently visible on the phone.
- Touch and drag on the phone to draw annotations. They appear on both screens simultaneously.
- Use the toolbar buttons to adjust detection mode, invert controls, or enable map rotation.

### Toolbar controls

| Button | Description |
|--------|-------------|
| Map | Activates the map example (the only built-in example) |
| Four Markers | Toggles between four-corner detection and single-marker mode |
| Invert | Flips the phone's position mapping so moving up moves the map north |
| No Rotation | When toggled to "Rotating", the phone's yaw rotates the mini-map |
| Copy Phone Link | Copies the phone URL to the clipboard |
| Show QR Code | Displays a QR code for the phone URL |

### Lighting tips

- Keep the phone screen brightness high — the markers need clear contrast.
- Avoid direct glare on the phone screen.
- If detection is unreliable, reduce ambient light reflections.
- When the phone is lost, the corner markers automatically grow to help re-acquisition.

---

## File Structure

```
server.js                        Node.js / Express / Socket.io server
public/
  index.html                     Laptop UI (webcam + overlay + map panel)
  css/style.css                  Dark professional theme
  js/
    app.js                       Main orchestrator (webcam loop, detection, state)
    jsarDetector.js              Detects ArUco markers via jsartoolkit5 (IDs 0/8/40/56)
    homography.js                Perspective-transform math (DLT algorithm)
    vendor/
      artoolkit.min.js           jsartoolkit5 self-contained bundle
    examples/
      mapExample.js              Leaflet map — phone position to geographic coordinate
  phone/
    index.html                   Phone PWA (auto-connects, no room code needed)
    manifest.json
    sw.js                        Service worker (offline cache)
    css/phone.css
    js/
      phoneApp.js                Auto-connection and example lifecycle
      drawMarker.js              Renders ArUco marker patterns onto canvas
      examples/
        mapPhone.js              Leaflet mini-map tracking the phone's geographic position
```

---

## Technical Notes

- Detection uses **jsartoolkit5** with 3x3 barcode markers at IDs 0 (top-left), 8 (top-right), 40 (bottom-left), 56 (bottom-right).
- All devices share a single server session — no room codes or pairing required.
- The phone mini-map renders at three zoom levels deeper than the laptop map and freezes during active drawing to keep strokes clean.
- Drawn paths are placed in a dedicated Leaflet pane (`drawPane`) at z-index 650 with `overflow: visible` to prevent clipping at tile boundaries.
