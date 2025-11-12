require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const User = require('./models/User');
const Device = require('./models/Device');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'devsecret';

// middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// connect mongodb
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(()=>console.log('MongoDB connected'))
.catch(err=>console.error('Mongo connect error', err));

// ----------- AUTH ROUTES -----------
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: 'Missing fields' });

    const existing = await User.findOne({ email });
    if (existing)
      return res.status(400).json({ error: 'Email already used' });

    const hash = await bcrypt.hash(password, 10);
    const u = new User({ name, email, passwordHash: hash });
    await u.save();

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const u = await User.findOne({ email });
    if (!u) return res.status(400).json({ error: 'Invalid credentials' });

    const isValid = await bcrypt.compare(password, u.passwordHash);
    if (!isValid) return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: u._id, email: u.email }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ token, user: { id: u._id, name: u.name, email: u.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ----------- AUTH MIDDLEWARE -----------
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'No token' });
  const token = auth.split(' ')[1];
  try {
    const data = jwt.verify(token, JWT_SECRET);
    req.user = data;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ----------- DEVICE ROUTES -----------
app.get('/api/devices', authMiddleware, async (req, res) => {
  const devices = await Device.find({ owner: req.user.id });
  res.json({ devices });
});

app.post('/api/devices', authMiddleware, async (req, res) => {
  const { espId, label } = req.body;
  if (!espId) return res.status(400).json({ error: 'espId required' });

  let d = await Device.findOne({ espId });
  if (d) {
    if (!d.owner) {
      d.owner = req.user.id;
      d.label = label || d.label;
      await d.save();
      return res.json({ device: d });
    } else if (String(d.owner) !== req.user.id) {
      return res.status(403).json({ error: 'Device already owned' });
    } else {
      return res.json({ device: d });
    }
  }
  d = new Device({ espId, owner: req.user.id, label });
  await d.save();
  res.json({ device: d });
});

// ----------- ESP8266 HTTP CONTROL -----------
// User sends control command -> updates DB -> ESP reads later
app.post('/api/control', authMiddleware, async (req, res) => {
  try {
    const { espId, pin, value } = req.body;
    if (!espId || pin === undefined || value === undefined)
      return res.status(400).json({ error: 'Invalid payload' });

    const device = await Device.findOne({ espId });
    if (!device || String(device.owner) !== String(req.user.id))
      return res.status(403).json({ error: 'Not owner of device' });

    // update pin state
    device.pins.set(String(pin), Number(value));
    await device.save();

    res.json({ ok: true, message: `Pin ${pin} set to ${value}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ESP8266 calls this to fetch latest pin states
app.get('/api/device-state/:espId', async (req, res) => {
  try {
    const { espId } = req.params;
    const device = await Device.findOne({ espId });
    if (!device) return res.status(404).json({ error: 'Device not found' });

    res.json({ pins: Object.fromEntries(device.pins) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ESP8266 can also update its pin values to server
app.post('/api/update', async (req, res) => {
  try {
    const { espId, pin, value } = req.body;
    if (!espId || pin === undefined || value === undefined)
      return res.status(400).json({ error: 'Invalid payload' });

    const device = await Device.findOne({ espId });
    if (!device) return res.status(404).json({ error: 'Device not found' });

    device.pins.set(String(pin), Number(value));
    await device.save();
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
