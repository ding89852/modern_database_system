import {
  api,
  escapeHtml,
  getLastUsername,
  getRecentUsernames,
  getToken,
  setLastUsername,
  setToken
} from '/api.js';

const slug = decodeURIComponent(
  location.pathname.split('/').filter(Boolean).pop() || ''
);
const startedAt = new Date().toISOString();
const submissionId =
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `sub-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const titleElement = document.getElementById('surveyTitle');
const descriptionElement = document.getElementById('surveyDescription');
const metaElement = document.getElementById('surveyMeta');
const loginPanel = document.getElementById('loginPanel');
const messagePanel = document.getElementById('messagePanel');
const pageMessage = document.getElementById('pageMessage');
const surveyForm = document.getElementById('surveyForm');
const questionList = document.getElementById('questionList');
const submitMessage = document.getElementById('submitMessage');
const submitBtn = document.getElementById('submitBtn');

let survey = null;
let submitted = false;
const answers = new Map();

function showLogin(message = '') {
  surveyForm.classList.add('hidden');
  messagePanel.classList.add('hidden');
  loginPanel.classList.remove('hidden');
  document.getElementById('loginMessage').textContent = message;

  const lastUsername = getLastUsername();
  const usernameInput = document.getElementById('fillUsername');
  if (lastUsername && !usernameInput.value) {
    usernameInput.value = lastUsername;
    document.getElementById('fillPassword').focus();
  }
  renderRecentUsers();
}

function renderRecentUsers() {
  const container = document.getElementById('lastUserHint');
  if (!container) return;
  const recent = getRecentUsernames();
  container.innerHTML = recent.length
    ? `<span class="hint">最近登录：</span>${recent
        .map(
          (name) =>
            `<button class="user-chip" type="button" data-username="${escapeHtml(
              name
            )}">${escapeHtml(name)}</button>`
        )
        .join('')}`
    : '';
}

document.getElementById('lastUserHint')?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-username]');
  if (!button) return;
  document.getElementById('fillUsername').value = button.dataset.username;
  document.getElementById('loginMessage').textContent = '';
  document.getElementById('fillPassword').focus();
});

function showMessage(message) {
  loginPanel.classList.add('hidden');
  surveyForm.classList.add('hidden');
  messagePanel.classList.remove('hidden');
  pageMessage.textContent = message;
}

function codePointLength(value) {
  return Array.from(value).length;
}

function optionHint(question) {
  const validation = question.validation || {};
  if (question.type === 'multiple') {
    const min = validation.minSelections;
    const max = validation.maxSelections;
    if (min != null && max != null) return `至少 ${min} 个，最多 ${max} 个`;
    if (min != null) return `至少 ${min} 个`;
    if (max != null) return `最多 ${max} 个`;
  }
  if (question.type === 'text') {
    const min = validation.minLength;
    const max = validation.maxLength;
    if (min != null && max != null) return `${min}–${max} 个字符`;
    if (min != null) return `至少 ${min} 个字符`;
    if (max != null) return `最多 ${max} 个字符`;
  }
  if (question.type === 'number') {
    const min = validation.min;
    const max = validation.max;
    const typeHint = validation.integer ? '必须是整数' : '可以填写小数';
    if (min != null && max != null) return `范围 ${min}–${max}，${typeHint}`;
    if (min != null) return `不小于 ${min}，${typeHint}`;
    if (max != null) return `不大于 ${max}，${typeHint}`;
    return typeHint;
  }
  return '';
}

function renderQuestion(question, index) {
  const card = document.createElement('article');
  card.className = 'question-card';
  card.dataset.questionId = question._id;
  card.dataset.order = question.order;

  const hint = optionHint(question);
  card.innerHTML = `
    <h3>
      第 ${index + 1} 题. ${escapeHtml(question.title)}
      ${question.required ? '<span class="required">*</span>' : ''}
    </h3>
    ${hint ? `<div class="question-hint">${escapeHtml(hint)}</div>` : ''}
    <div class="answer-area"></div>
    <p class="error"></p>
  `;

  const area = card.querySelector('.answer-area');

  if (question.type === 'single' || question.type === 'multiple') {
    for (const option of question.options || []) {
      const wrapper = document.createElement('div');
      wrapper.className = 'option';
      const input = document.createElement('input');
      input.type = question.type === 'single' ? 'radio' : 'checkbox';
      input.name = `q_${question._id}`;
      input.value = option._id;

      const label = document.createElement('label');
      label.textContent = option.label;
      label.prepend(input);
      wrapper.appendChild(label);
      area.appendChild(wrapper);

      input.addEventListener('change', () => handleAnswerChange(question, card));
    }
  } else if (question.type === 'text') {
    const textarea = document.createElement('textarea');
    textarea.placeholder = '请输入';
    if (question.validation?.maxLength != null) {
      textarea.maxLength = question.validation.maxLength;
    }
    area.appendChild(textarea);
    textarea.addEventListener('input', () => handleAnswerChange(question, card));
  } else {
    const input = document.createElement('input');
    input.type = 'number';
    input.placeholder = '请输入数字';
    input.step = question.validation?.integer ? '1' : 'any';
    input.inputMode = question.validation?.integer ? 'numeric' : 'decimal';
    if (question.validation?.min != null) input.min = question.validation.min;
    if (question.validation?.max != null) input.max = question.validation.max;
    area.appendChild(input);
    input.addEventListener('input', () => handleAnswerChange(question, card));
  }

  questionList.appendChild(card);
}

function readAnswer(question, card) {
  if (question.type === 'single') {
    const checked = card.querySelector('input[type="radio"]:checked');
    return checked ? checked.value : undefined;
  }
  if (question.type === 'multiple') {
    const values = [...card.querySelectorAll('input[type="checkbox"]:checked')].map(
      (input) => input.value
    );
    return values.length ? values : undefined;
  }
  if (question.type === 'text') {
    const value = card.querySelector('textarea').value;
    return value.trim() ? value : undefined;
  }
  const raw = card.querySelector('input[type="number"]').value;
  if (raw === '') return undefined;
  const value = Number(raw);
  return Number.isNaN(value) ? undefined : value;
}

function evaluateWhen(question, when, value) {
  if (question.type === 'single') {
    return when.operator === 'eq' && value === when.value;
  }
  if (question.type === 'multiple') {
    if (when.operator !== 'setEq' || !Array.isArray(when.value)) return false;
    const actual = new Set(value);
    const expected = new Set(when.value);
    if (actual.size !== expected.size) return false;
    for (const item of actual) {
      if (!expected.has(item)) return false;
    }
    return true;
  }
  if (question.type === 'number') {
    switch (when.operator) {
      case 'eq':
        return value === when.value;
      case 'ne':
        return value !== when.value;
      case 'gt':
        return value > when.value;
      case 'gte':
        return value >= when.value;
      case 'lt':
        return value < when.value;
      case 'lte':
        return value <= when.value;
      case 'between':
        return (
          Array.isArray(when.value) &&
          value >= when.value[0] &&
          value <= when.value[1]
        );
      default:
        return false;
    }
  }
  return false;
}

function getJumpTarget(question, value) {
  const rules = [...(question.jumpRules || [])].sort(
    (a, b) => a.priority - b.priority
  );
  for (const rule of rules) {
    if (evaluateWhen(question, rule.when, value)) {
      return rule.target;
    }
  }
  return null;
}

function computeVisibleQuestions() {
  const questions = [...(survey.questions || [])].sort((a, b) => a.order - b.order);
  if (!questions.length) return new Set();

  const byId = new Map(questions.map((question) => [question._id, question]));
  const nextById = new Map();
  questions.forEach((question, index) => {
    nextById.set(question._id, questions[index + 1] || null);
  });

  const visible = new Set();
  let current = questions[0];
  let steps = 0;

  while (current && steps < questions.length * 2 + 10) {
    steps += 1;
    visible.add(current._id);
    const value = answers.get(current._id);
    if (value === undefined) {
      current = nextById.get(current._id);
      continue;
    }

    const target = getJumpTarget(current, value);
    if (target?.type === 'end') break;
    if (target?.type === 'question') {
      current = byId.get(target.questionId) || nextById.get(current._id);
    } else {
      current = nextById.get(current._id);
    }
  }

  return visible;
}

function clearQuestion(card) {
  for (const input of card.querySelectorAll('input')) {
    if (input.type === 'radio' || input.type === 'checkbox') input.checked = false;
    else input.value = '';
  }
  const textarea = card.querySelector('textarea');
  if (textarea) textarea.value = '';
  card.classList.remove('invalid');
  const error = card.querySelector('.error');
  if (error) error.textContent = '';
}

function updateVisibility() {
  const visible = computeVisibleQuestions();
  for (const card of questionList.querySelectorAll('.question-card')) {
    const id = card.dataset.questionId;
    if (visible.has(id)) {
      card.classList.remove('skipped');
    } else {
      card.classList.add('skipped');
      answers.delete(id);
      clearQuestion(card);
    }
  }
}

function findCard(questionId) {
  return [...questionList.querySelectorAll('.question-card')].find(
    (card) => card.dataset.questionId === questionId
  );
}

function scrollToQuestion(questionId) {
  const card = findCard(questionId);
  if (!card) return;
  requestAnimationFrame(() => {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

function handleAnswerChange(question, card) {
  const value = readAnswer(question, card);
  if (value === undefined) answers.delete(question._id);
  else answers.set(question._id, value);

  card.classList.remove('invalid');
  const error = card.querySelector('.error');
  if (error) error.textContent = '';

  const target = value === undefined ? null : getJumpTarget(question, value);
  updateVisibility();

  if (target?.type === 'end') {
    document.querySelector('.submit-bar')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else if (target?.type === 'question') {
    scrollToQuestion(target.questionId);
  }
}

function validateQuestion(question, card) {
  const value = answers.get(question._id);
  const error = card.querySelector('.error');
  card.classList.remove('invalid');
  if (error) error.textContent = '';

  if (value === undefined || value === null) {
    if (question.required) {
      card.classList.add('invalid');
      if (error) error.textContent = '这道题必须回答';
      return false;
    }
    return true;
  }

  if (question.type === 'multiple') {
    const min = question.validation?.minSelections;
    const max = question.validation?.maxSelections;
    if (!Array.isArray(value) || value.length === 0) {
      card.classList.add('invalid');
      if (error) error.textContent = '至少选择 1 个选项';
      return false;
    }
    if (min != null && value.length < min) {
      card.classList.add('invalid');
      if (error) error.textContent = `至少选择 ${min} 个选项`;
      return false;
    }
    if (max != null && value.length > max) {
      card.classList.add('invalid');
      if (error) error.textContent = `最多选择 ${max} 个选项`;
      return false;
    }
  }

  if (question.type === 'text') {
    const length = codePointLength(value);
    const min = question.validation?.minLength;
    const max = question.validation?.maxLength;
    if (length === 0) {
      card.classList.add('invalid');
      if (error) error.textContent = '文本不能为空';
      return false;
    }
    if (min != null && length < min) {
      card.classList.add('invalid');
      if (error) error.textContent = `至少输入 ${min} 个字符`;
      return false;
    }
    if (max != null && length > max) {
      card.classList.add('invalid');
      if (error) error.textContent = `最多输入 ${max} 个字符`;
      return false;
    }
  }

  if (question.type === 'number') {
    if (!Number.isFinite(value)) {
      card.classList.add('invalid');
      if (error) error.textContent = '请输入合法数字';
      return false;
    }
    if (question.validation?.integer && !Number.isInteger(value)) {
      card.classList.add('invalid');
      if (error) error.textContent = '必须是整数';
      return false;
    }
    if (question.validation?.min != null && value < question.validation.min) {
      card.classList.add('invalid');
      if (error) error.textContent = `不能小于 ${question.validation.min}`;
      return false;
    }
    if (question.validation?.max != null && value > question.validation.max) {
      card.classList.add('invalid');
      if (error) error.textContent = `不能大于 ${question.validation.max}`;
      return false;
    }
  }

  return true;
}

function validateForm() {
  const visible = computeVisibleQuestions();
  let firstInvalid = null;
  for (const question of survey.questions) {
    if (!visible.has(question._id)) continue;
    const card = findCard(question._id);
    if (!card) continue;
    if (!validateQuestion(question, card) && !firstInvalid) {
      firstInvalid = card;
    }
  }
  if (firstInvalid) {
    firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  }
  return true;
}

function buildAnswers() {
  const visible = computeVisibleQuestions();
  return survey.questions
    .filter((question) => visible.has(question._id) && answers.has(question._id))
    .map((question) => ({
      questionId: question._id,
      value: answers.get(question._id)
    }));
}

function renderSurvey(data) {
  survey = data;
  titleElement.textContent = data.title;
  descriptionElement.textContent = data.description || '';
  const deadline = data.deadline
    ? ` · 截止：${new Date(data.deadline).toLocaleString()}`
    : '';
  metaElement.textContent = `${data.allowAnonymous ? '匿名填写' : '记名填写'}${deadline}`;

  questionList.innerHTML = '';
  [...data.questions]
    .sort((a, b) => a.order - b.order)
    .forEach((question, index) => renderQuestion(question, index));

  loginPanel.classList.add('hidden');
  messagePanel.classList.add('hidden');
  surveyForm.classList.remove('hidden');
  updateVisibility();
}

async function loadSurvey() {
  if (!getToken()) {
    showLogin();
    return;
  }

  try {
    const data = await api(`/api/fill/surveys/${encodeURIComponent(slug)}`);
    renderSurvey(data);
  } catch (error) {
    if (error.status === 401) {
      setToken('');
      showLogin('请先登录');
    } else {
      showMessage(error.message);
    }
  }
}

document.getElementById('fillLoginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = document.getElementById('loginMessage');
  message.textContent = '';
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: {
        username: document.getElementById('fillUsername').value.trim(),
        password: document.getElementById('fillPassword').value
      }
    });
    setLastUsername(data.user.username);
    setToken(data.token);
    await loadSurvey();
  } catch (error) {
    message.textContent = error.message;
  }
});

surveyForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (submitted) return;
  submitMessage.textContent = '';

  if (!validateForm()) return;
  const payloadAnswers = buildAnswers();
  if (!payloadAnswers.length) {
    submitMessage.textContent = '请至少回答一道题目';
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = '提交中...';
  try {
    await api(`/api/fill/surveys/${encodeURIComponent(slug)}/responses`, {
      method: 'POST',
      body: {
        submissionId,
        answers: payloadAnswers,
        startedAt
      }
    });
    submitted = true;
    surveyForm.classList.add('hidden');
    showMessage('提交成功，感谢填写。');
  } catch (error) {
    submitMessage.textContent = error.message;
    submitBtn.disabled = false;
    submitBtn.textContent = '提交问卷';
    if (error.status === 401) showLogin('登录已失效，请重新登录');
  }
});

loadSurvey();
