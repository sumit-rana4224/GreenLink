const base = '';

document.getElementById('btn-register').addEventListener('click', async () => {
  const name = document.getElementById('reg-name').value;
  const email = document.getElementById('reg-email').value;
  const password = document.getElementById('reg-pass').value;
  const r = await fetch(base + '/api/register', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ name, email, password })
  });
  const j = await r.json();
  if(j.ok) {
    showMessage('Registered — now login');
  } else showMessage(j.error || 'Error');
});

document.getElementById('btn-login').addEventListener('click', async () => {
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-pass').value;
  const r = await fetch(base + '/api/login', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ email, password })
  });
  const j = await r.json();
  if(j.token) {
    localStorage.setItem('token', j.token);
    localStorage.setItem('user', JSON.stringify(j.user));
    window.location.href = '/dashboard.html';
  } else {
    showMessage(j.error || 'Login failed');
  }
});

function showMessage(t) {
  document.getElementById('message').innerText = t;
}
