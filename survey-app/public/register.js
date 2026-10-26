import { api, setLastUsername, setToken } from '/api.js';

const form = document.getElementById('registerForm');
const message = document.getElementById('message');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = '';

  try {
    const data = await api('/api/auth/register', {
      method: 'POST',
      token: '',
      body: {
        username: document.getElementById('username').value.trim(),
        password: document.getElementById('password').value
      }
    });
    setLastUsername(data.user.username);
    setToken(data.token);
    location.replace('/');
  } catch (error) {
    message.textContent = error.message;
  }
});
