import {
  api,
  escapeHtml,
  getLastUsername,
  getRecentUsernames,
  setLastUsername,
  setToken
} from '/api.js';

const form = document.getElementById('loginForm');
const message = document.getElementById('message');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const lastUserHint = document.getElementById('lastUserHint');

const recentUsernames = getRecentUsernames();
if (recentUsernames.length) {
  lastUserHint.innerHTML = `<span class="hint">最近登录：</span>${recentUsernames
    .map(
      (name) =>
        `<button class="user-chip" type="button" data-username="${escapeHtml(
          name
        )}">${escapeHtml(name)}</button>`
    )
    .join('')}`;
}

const lastUsername = getLastUsername();
if (lastUsername) {
  usernameInput.value = lastUsername;
  passwordInput.focus();
}

lastUserHint.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-username]');
  if (!button) return;
  usernameInput.value = button.dataset.username;
  message.textContent = '';
  passwordInput.focus();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = '';

  try {
    const data = await api('/api/auth/login', {
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
