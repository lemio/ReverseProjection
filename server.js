const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// In-memory rate limiter: 120 HTTP requests per IP per minute across all routes
const httpRateMap = new Map();
function rateLimit(req, res, next) {
  const ip  = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
  const now = Date.now();
  const entry = httpRateMap.get(ip) || { count: 0, resetAt: now + 60_000 };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 60_000; }
  entry.count++;
  httpRateMap.set(ip, entry);
  if (entry.count > 120) {
    return res.status(429).send('Too Many Requests');
  }
  next();
}
app.use(rateLimit);

// Serve the phone PWA index for both /phone and /phone/
app.get(['/phone', '/phone/'], rateLimit, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'phone', 'index.html'));
});

// Serve other phone static assets (/phone/css, /phone/js, /phone/manifest.json, etc.)
app.use('/phone', express.static(path.join(__dirname, 'public', 'phone')));

// Serve remaining static files from public/
app.use(express.static(path.join(__dirname, 'public')));

// All devices share one session — no room codes required.
// Any connecting socket is a participant; laptops and phones find each other automatically.
const ROOM = 'main';

io.on('connection', (socket) => {
  let myType = null;

  socket.on('device:register', ({ type }) => {
    myType = type;
    socket.join(ROOM);

    // Notify others that a new device joined
    socket.to(ROOM).emit('device:status', { type, connected: true });

    // Tell the newcomer about every device already in the room
    const otherType = type === 'laptop' ? 'phone' : 'laptop';
    const roomSockets = io.sockets.adapter.rooms.get(ROOM);
    if (roomSockets && roomSockets.size > 1) {
      socket.emit('device:status', { type: otherType, connected: true });
    }
  });

  socket.on('phone:touch',   (data) => { socket.to(ROOM).emit('phone:touch',   data); });
  socket.on('laptop:state',  (data) => { socket.to(ROOM).emit('laptop:state',  data); });
  socket.on('config:change', (data) => { socket.to(ROOM).emit('config:change', data); });

  socket.on('disconnect', () => {
    if (myType) socket.to(ROOM).emit('device:status', { type: myType, connected: false });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`ReverseProjection server running at http://localhost:${PORT}`);
});
