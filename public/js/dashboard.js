const token = localStorage.getItem('token');
if(!token) location.href = '/';

const socket = io(); // connects to same host

socket.on('connect', () => {
  socket.emit('controller-register', { token });
  setStatus('Socket connected: ' + socket.id);
});
socket.on('controller-ack', () => setStatus('Controller registered'));
socket.on('error', (e) => setStatus('Socket error: ' + JSON.stringify(e)));
socket.on('esp-pin-update', (data) => {
  // update UI pin state
  const el = document.querySelector(`#pin-${data.espId}-${data.pin}`);
  if(el) el.value = data.value;
});

async function fetchDevices() {
  const r = await fetch('/api/devices', { headers: { 'Authorization': 'Bearer '+token }});
  const j = await r.json();
  const list = document.getElementById('device-list');
  list.innerHTML = '';
  for(const d of j.devices) {
    const li = document.createElement('li');
    li.innerHTML = `<b>${d.label || d.espId}</b> (espId: ${d.espId}) <button data-esp="${d.espId}">Select</button>`;
    list.appendChild(li);
    li.querySelector('button').addEventListener('click', ()=> selectDevice(d));
  }
}

document.getElementById('btn-add').addEventListener('click', async () => {
  const espId = document.getElementById('esp-id').value.trim();
  const label = document.getElementById('esp-label').value.trim();
  if(!espId) return alert('espId required');
  const r = await fetch('/api/devices', {
    method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
    body: JSON.stringify({ espId, label })
  });
  const j = await r.json();
  if(j.device) {
    fetchDevices();
    alert('Device added/claimed');
  } else {
    alert(j.error || 'Error');
  }
});

function selectDevice(device) {
  document.getElementById('controls').style.display = 'block';
  document.getElementById('device-title').innerText = `Device: ${device.label||device.espId}`;
  // show pin controls (common ESP8266 pins — user can adjust)
  const pinsDiv = document.getElementById('pins');
  pinsDiv.innerHTML = '';
  const pinsToShow = [0,1,2,3,4,5,12,13,14]; // modify as per board
  pinsToShow.forEach(pin => {
    const row = document.createElement('div');
    const input = document.createElement('input');
    input.type = 'number';
    input.min = 0; input.max = 1; input.value = device.pins && device.pins[pin] !== undefined ? device.pins[pin] : 0;
    input.id = `pin-${device.espId}-${pin}`;
    const btn = document.createElement('button');
    btn.innerText = 'Set';
    btn.addEventListener('click', () => {
      const value = Number(input.value) ? 1 : 0;
      socket.emit('control-pin', { espId: device.espId, pin, value });
    });
    row.innerHTML = `<span>GPIO${pin}</span> `;
    row.appendChild(input); row.appendChild(btn);
    pinsDiv.appendChild(row);
  });
}

socket.on('control-result', (d) => {
  setStatus('Control result: ' + JSON.stringify(d));
});

function setStatus(t) { document.getElementById('status').innerText = t; }

document.getElementById('btn-logout').addEventListener('click', () => {
  localStorage.removeItem('token'); localStorage.removeItem('user');
  location.href = '/';
});

fetchDevices();
