import { api, escapeHtml, getToken } from '/api.js';

const token = decodeURIComponent(
  location.pathname.split('/').filter(Boolean).pop() || ''
);
const pageMessage = document.getElementById('pageMessage');
const questionPanel = document.getElementById('questionPanel');
const questionTitle = document.getElementById('questionTitle');
const questionMeta = document.getElementById('questionMeta');
const questionContent = document.getElementById('questionContent');
const shareUrl = document.getElementById('shareUrl');

function showMessage(text) {
  document.getElementById('messagePanel').classList.remove('hidden');
  questionPanel.classList.add('hidden');
  pageMessage.textContent = text;
}

async function load() {
  if (!getToken()) {
    location.replace('/login');
    return;
  }
  try {
    const question = await api(`/api/shared-questions/${encodeURIComponent(token)}`);
    questionPanel.classList.remove('hidden');
    questionTitle.textContent = question.title;
    questionMeta.textContent = `${question.type}${question.questionVersion ? ` · v${question.questionVersion}` : ''}`;
    shareUrl.value = location.href;
    if (question.type === 'single' || question.type === 'multiple') {
      questionContent.innerHTML = (question.options || [])
        .map((option) => `<div class="option"><label><input disabled type="${question.type === 'single' ? 'radio' : 'checkbox'}" /> ${escapeHtml(option.label)}</label></div>`)
        .join('');
    } else {
      questionContent.innerHTML = `<p class="hint">${question.type === 'text' ? '文本填空题' : '数字填空题'}</p>`;
    }
  } catch (error) {
    showMessage(error.message);
  }
}

document.getElementById('copyLinkBtn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    document.getElementById('copyMessage').textContent = '链接已复制';
  } catch {
    document.getElementById('copyMessage').textContent = '复制失败，请手动选择链接';
  }
});

load();
