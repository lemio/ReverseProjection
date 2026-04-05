const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Simple in-memory rate limiter for the phone route (max 60 req/min per IP)
const phoneRateMap = new Map();
function phoneRateLimit(req, res, next) {
  const ip  = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = phoneRateMap.get(ip) || { count: 0, resetAt: now + 60_000 };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 60_000; }
  entry.count++;
  phoneRateMap.set(ip, entry);
  if (entry.count > 60) {
    return res.status(429).send('Too Many Requests');
  }
  next();
}

// Phone app route — must be declared before the static middleware
// so the bare /phone path is handled explicitly (avoids directory redirect)
app.get('/phone', phoneRateLimit, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'phone', 'index.html'));
});

// Serve static files from public/
app.use(express.static(path.join(__dirname, 'public')));

// Track rooms: roomId -> { laptop: socketId, phone: socketId }
const rooms = new Map();

io.on('connection', (socket) => {
  let myRoom = null;
  let myType = null;

  socket.on('device:register', ({ type, roomId }) => {
    myRoom = roomId;
    myType = type;
    socket.join(roomId);

    if (!rooms.has(roomId)) rooms.set(roomId, {});
    rooms.get(roomId)[type] = socket.id;

    // Notify the room
    socket.to(roomId).emit('device:status', { type, connected: true });
    // Also tell the registering device about existing connections
    const room = rooms.get(roomId);
    const otherType = type === 'laptop' ? 'phone' : 'laptop';
    if (room[otherType]) {
      socket.emit('device:status', { type: otherType, connected: true });
    }
  });

  socket.on('phone:touch', (data) => {
    if (myRoom) socket.to(myRoom).emit('phone:touch', data);
  });

  socket.on('laptop:state', (data) => {
    if (myRoom) socket.to(myRoom).emit('laptop:state', data);
  });

  socket.on('config:change', (data) => {
    if (myRoom) socket.to(myRoom).emit('config:change', data);
  });

  socket.on('disconnect', () => {
    if (myRoom && myType) {
      const room = rooms.get(myRoom);
      if (room) {
        delete room[myType];
        if (!room.laptop && !room.phone) rooms.delete(myRoom);
      }
      socket.to(myRoom).emit('device:status', { type: myType, connected: false });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`ReverseProjection server running at http://localhost:${PORT}`);
});
