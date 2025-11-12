const mongoose = require('mongoose');

const DeviceSchema = new mongoose.Schema({
  espId: { type: String, required: true, unique: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  label: String,
  // optional: store last known pin states
  pins: { type: Map, of: Number, default: {} }
}, { timestamps: true });

module.exports = mongoose.model('Device', DeviceSchema);
