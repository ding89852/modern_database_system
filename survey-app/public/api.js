export const tokenKey = 'survey_token';
export const lastUsernameKey = 'survey_last_username';
export const recentUsernamesKey = 'survey_recent_usernames';

export function getToken() {
  return localStorage.getItem(tokenKey) || '';
}

export function setToken(value) {
  if (value) localStorage.setItem(tokenKey, value);
  else localStorage.removeItem(tokenKey);
}

export function getLastUsername() {
  return localStorage.getItem(lastUsernameKey) || '';
}

export function getRecentUsernames() {
  try {
    const list = JSON.parse(localStorage.getItem(recentUsernamesKey) || '[]');
    if (Array.isArray(list)) {
      return list.filter((item) => typeof item === 'string' && item);
    }
  } catch {
    // 忽略损坏的缓存，回退到最近一次用户名
  }
  const last = getLastUsername();
  return last ? [last] : [];
}

export function setLastUsername(username) {
  if (!username) return;
  localStorage.setItem(lastUsernameKey, username);
  const recent = getRecentUsernames().filter((item) => item !== username);
  recent.unshift(username);
  localStorage.setItem(
    recentUsernamesKey,
    JSON.stringify(recent.slice(0, 5))
  );
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export async function api(path, { method = 'GET', body, token = getToken() } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  if (response.status === 204) return {};
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detailText = (data.error?.details || [])
      .map((detail) => detail.message)
      .filter(Boolean)
      .join('；');
    const message =
      detailText ||
      data.error?.message ||
      `请求失败（${response.status}）`;
    const error = new Error(message);
    error.status = response.status;
    error.code = data.error?.code;
    throw error;
  }

  return data;
}
