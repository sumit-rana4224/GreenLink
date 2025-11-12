require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const User = require('./models/User');
const Device = require('./models/Device');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET","POST"]
  }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'devsecret';

// middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// connect mongodb
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true, useUnifiedTopology: true
}).then(()=>console.log('MongoDB connected'))
  .catch(err=>console.error('Mongo connect error', err));

// --- Auth endpoints ---
// register
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if(!name||!email||!password) return res.status(400).json({ error: 'Missing fields' });
    const existing = await User.findOne({ email });
    if(existing) return res.status(400).json({ error: 'Email already used' });
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);
    const u = new User({ name, email, passwordHash: hash });
    await u.save();
    res.json({ ok: true });
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const u = await User.findOne({ email });
    if(!u) return res.status(400).json({ error: 'Invalid credentials' });
    const isValid = await bcrypt.compare(password, u.passwordHash);
    if(!isValid) return res.status(400).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: u._id, email: u.email }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ token, user: { id: u._id, name: u.name, email: u.email } });
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// protected helper
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if(!auth) return res.status(401).json({ error: 'No token' });
  const token = auth.split(' ')[1];
  try {
    const data = jwt.verify(token, JWT_SECRET);
    req.user = data;
    next();
  } catch(e) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// manage devices (list, add)
app.get('/api/devices', authMiddleware, async (req, res) => {
  const devices = await Device.find({ owner: req.user.id });
  res.json({ devices });
});

app.post('/api/devices', authMiddleware, async (req, res) => {
  const { espId, label } = req.body;
  if(!espId) return res.status(400).json({ error: 'espId required' });
  let d = await Device.findOne({ espId });
  if(d) {
    // if device exists but not owned, allow claim
    if(!d.owner) {
      d.owner = req.user.id; d.label = label || d.label;
      await d.save();
      return res.json({ device: d });
    } else if(String(d.owner) !== req.user.id) {
      return res.status(403).json({ error: 'Device already owned' });
    } else {
      return res.json({ device: d });
    }
  }
  d = new Device({ espId, owner: req.user.id, label });
  await d.save();
  res.json({ device: d });
});

// ----------------- SOCKET.IO real-time -----------------
// We will maintain two maps: espId -> socket, and userId -> socket(s)
const espSockets = new Map();        // espId => socket
const controlSockets = new Map();    // socket.id => userId (for controllers)

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  // First message from an ESP should be "esp-register" with { espId, authToken? }
  socket.on('esp-register', async (payload) => {
    try {
      const { espId, token } = payload || {};
      if(!espId) return socket.emit('error', 'espId required');
      // optional: if you want to verify token to allow only registered users to have device ownership,
      // you could check token here. For now we accept registration and store socket.
      espSockets.set(espId, socket);
      socket.data.espId = espId;
      console.log('ESP registered', espId);
      // update DB last seen
      await Device.findOneAndUpdate({ espId }, { $set: { lastSeen: new Date() } }, { upsert: true });
      socket.emit('esp-ack', { ok: true, espId });
    } catch(e) {
      console.error(e);
    }
  });

  // Controllers (browser) should send "controller-register" with token to identify user session
  socket.on('controller-register', async (payload) => {
    try {
      const { token } = payload || {};
      if(!token) return socket.emit('error', 'token required');
      const data = jwt.verify(token, process.env.JWT_SECRET || JWT_SECRET);
      socket.data.userId = data.id;
      controlSockets.set(socket.id, data.id);
      console.log('Controller registered user', data.email || data.id);
      socket.emit('controller-ack', { ok: true });
    } catch(e) {
      socket.emit('error', 'Invalid token');
    }
  });

  // from browser: request to control pin => { espId, pin, value }
  socket.on('control-pin', async (payload) => {
    try {
      const userId = socket.data.userId;
      if(!userId) return socket.emit('error', 'unauthenticated');
      const { espId, pin, value } = payload;
      if(!espId || pin === undefined || value === undefined) return socket.emit('error', 'invalid payload');
      // check ownership
      const device = await Device.findOne({ espId });
      if(!device || String(device.owner) !== String(userId)) {
        return socket.emit('error', 'not owner of device');
      }
      const espSocket = espSockets.get(espId);
      if(!espSocket) return socket.emit('error', 'esp offline');
      // forward command to ESP
      espSocket.emit('cmd-set-pin', { pin, value });
      // optionally update DB
      device.pins.set(String(pin), Number(value));
      await device.save();
      socket.emit('control-result', { ok: true });
    } catch(e) {
      console.error(e);
      socket.emit('error', 'server error');
    }
  });

  // ESP can send pin-state updates
  socket.on('esp-pin-state', async (payload) => {
    try {
      const { espId, pin, value } = payload;
      if(!espId) return;
      const device = await Device.findOne({ espId });
      if(device) {
        device.pins.set(String(pin), Number(value));
        await device.save();
      }
      // broadcast to controllers that own this device
      for(const [sid, uid] of controlSockets.entries()) {
        if(String(uid) === String(device?.owner)) {
          io.to(sid).emit('esp-pin-update', { espId, pin, value });
        }
      }
    } catch(e) { console.error(e); }
  });

  socket.on('disconnect', () => {
    console.log('socket disconnect', socket.id);
    // if it was an ESP registered, remove
    if(socket.data.espId) {
      espSockets.delete(socket.data.espId);
    }
    if(controlSockets.has(socket.id)) controlSockets.delete(socket.id);
  });
});

// start server
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
