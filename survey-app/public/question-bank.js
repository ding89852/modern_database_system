import { api, escapeHtml, getToken } from '/api.js';

const typeLabels = {
  single: '单选',
  multiple: '多选',
  text: '文本填空',
  number: '数字填空'
};

let currentUser = null;
let editing = null;
let bankQuestions = [];
let searchTimer = null;

const editorTitle = document.getElementById('editorTitle');
const form = document.getElementById('questionForm');
const typeInput = document.getElementById('typeInput');
const titleInput = document.getElementById('titleInput');
const requiredInput = document.getElementById('requiredInput');
const optionsInput = document.getElementById('optionsInput');
const optionsGroup = document.getElementById('optionsGroup');
const multipleValidation = document.getElementById('multipleValidation');
const textValidation = document.getElementById('textValidation');
const numberValidation = document.getElementById('numberValidation');
const minSelectionsInput = document.getElementById('minSelectionsInput');
const maxSelectionsInput = document.getElementById('maxSelectionsInput');
const minLengthInput = document.getElementById('minLengthInput');
const maxLengthInput = document.getElementById('maxLengthInput');
const minInput = document.getElementById('minInput');
const maxInput = document.getElementById('maxInput');
const numberModeInput = document.getElementById('numberModeInput');
const changeNoteInput = document.getElementById('changeNoteInput');
const createShareInput = document.getElementById('createShareInput');
const saveQuestionBtn = document.getElementById('saveQuestionBtn');
const message = document.getElementById('message');
const bankList = document.getElementById('bankList');
const bankDetail = document.getElementById('bankDetail');
const searchInput = document.getElementById('searchInput');
const typeFilter = document.getElementById('typeFilter');

function numberOrNull(input) {
  return input.value === '' ? null : Number(input.value);
}

function updateFormVisibility() {
  const type = typeInput.value;
  const isChoice = type === 'single' || type === 'multiple';
  optionsGroup.classList.toggle('hidden', !isChoice);
  multipleValidation.classList.toggle('hidden', type !== 'multiple');
  textValidation.classList.toggle('hidden', type !== 'text');
  numberValidation.classList.toggle('hidden', type !== 'number');
}

function buildPayload() {
  const type = typeInput.value;
  const options =
    type === 'single' || type === 'multiple'
      ? optionsInput.value
          .split('\n')
          .map((label) => label.trim())
          .filter(Boolean)
          .map((label) => ({ label }))
      : [];

  let validation = {};
  if (type === 'multiple') {
    validation = {
      minSelections: numberOrNull(minSelectionsInput),
      maxSelections: numberOrNull(maxSelectionsInput)
    };
  } else if (type === 'text') {
    validation = {
      minLength: numberOrNull(minLengthInput),
      maxLength: numberOrNull(maxLengthInput)
    };
  } else if (type === 'number') {
    validation = {
      min: numberOrNull(minInput),
      max: numberOrNull(maxInput),
      integer: numberModeInput.value === 'integer'
    };
  }

  return {
    type,
    title: titleInput.value.trim(),
    required: requiredInput.checked,
    options,
    validation,
    changeNote: changeNoteInput.value.trim()
  };
}

function fillForm(question) {
  editing = question;
  editorTitle.textContent = `编辑题目（当前 v${question.version}，保存为新版本）`;
  typeInput.value = question.type;
  titleInput.value = question.title;
  requiredInput.checked = Boolean(question.required);
  optionsInput.value = (question.options || []).map((option) => option.label).join('\n');
  const validation = question.validation || {};
  minSelectionsInput.value = validation.minSelections ?? '';
  maxSelectionsInput.value = validation.maxSelections ?? '';
  minLengthInput.value = validation.minLength ?? '';
  maxLengthInput.value = validation.maxLength ?? '';
  minInput.value = validation.min ?? '';
  maxInput.value = validation.max ?? '';
  numberModeInput.value = validation.integer ? 'integer' : 'decimal';
  changeNoteInput.value = '';
  updateFormVisibility();
  document.querySelector('.card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetForm() {
  editing = null;
  form.reset();
  typeInput.value = 'single';
  requiredInput.checked = false;
  numberModeInput.value = 'decimal';
  editorTitle.textContent = '新建题目';
  changeNoteInput.value = '';
  updateFormVisibility();
}

function questionBadges(question) {
  return `<span class="badge">${question.isShared ? '已生成共享链接' : '仅自己可见'}</span><span class="badge">v${question.version}</span>`;
}

function renderBank() {
  if (!bankQuestions.length) {
    bankList.innerHTML = '<p class="hint">暂无题目。先在上方创建一道题。</p>';
    return;
  }

  bankList.innerHTML = bankQuestions
    .map((question) => {
      return `
        <div class="survey-item bank-item" data-id="${question._id}" data-family="${question.familyId}">
          <div class="row space-between">
            <h3>${escapeHtml(question.title)}</h3>
            <div>${questionBadges(question)}</div>
          </div>
          <div class="meta">${typeLabels[question.type] || question.type} · 创建者版本 v${question.version}</div>
          <div class="row">
            <button class="secondary" data-action="edit" type="button">编辑为新版本</button>
            <button class="secondary" data-action="share-link" type="button">生成共享链接</button>
            <button class="secondary" data-action="derive" type="button">另存为新题</button>
            <button class="secondary" data-action="history" type="button">历史版本</button>
            <button class="secondary" data-action="usages" type="button">使用问卷</button>
            <button class="secondary" data-action="stats" type="button">跨问卷统计</button>
          </div>
        </div>
      `;
    })
    .join('');
}

async function loadBank() {
  const params = new URLSearchParams({ pageSize: '100' });
  if (searchInput.value.trim()) params.set('q', searchInput.value.trim());
  if (typeFilter.value) params.set('type', typeFilter.value);
  const data = await api(`/api/question-bank?${params.toString()}`);
  bankQuestions = data.items || [];
  renderBank();
}

async function showHistory(familyId) {
  const data = await api(`/api/question-bank/${familyId}/history`);
  const versionById = new Map(
    data.items.map((version) => [version._id, version.version])
  );
  bankDetail.classList.remove('hidden');
  bankDetail.innerHTML = `
    <div class="row space-between"><h3>版本历史</h3><button class="secondary" data-action="close-detail" type="button">关闭</button></div>
    ${data.items
      .map(
        (version) => `
          <div class="version-row">
            <div>
              <strong>v${version.version}</strong>
              <span class="hint">${escapeHtml(version.title)} · ${new Date(version.createdAt).toLocaleString()}</span>
              ${version.changeNote ? `<div class="hint">${escapeHtml(version.changeNote)}</div>` : ''}
              ${
                version.previousVersionId
                  ? `<div class="hint">基于本题目 v${versionById.get(version.previousVersionId) ?? '?'}</div>`
                  : ''
              }
              ${
                version.derivedFromVersionId
                  ? `<div class="hint">派生自其他题目 v${versionById.get(version.derivedFromVersionId) ?? '?'}</div>`
                  : ''
              }
            </div>
            <div class="row">
              ${version.isLatest ? '<span class="badge">当前版本</span>' : ''}
              <button class="secondary" data-action="use-version" data-id="${version._id}" type="button">用于新问卷</button>
              ${
                version.ownerId === currentUser?.id && !version.isLatest
                  ? `<button class="secondary" data-action="restore" data-id="${version._id}" type="button">恢复为最新版本</button>`
                  : ''
              }
            </div>
          </div>
        `
      )
      .join('')}
  `;
}

async function showUsages(familyId) {
  const data = await api(`/api/question-bank/${familyId}/usages`);
  bankDetail.classList.remove('hidden');
  bankDetail.innerHTML = `
    <div class="row space-between"><h3>使用问卷（${data.surveyCount}）</h3><button class="secondary" data-action="close-detail" type="button">关闭</button></div>
    ${
      data.items.length
        ? data.items
            .map(
              (item) => `
                <div class="version-row">
                  <div><strong>${escapeHtml(item.title)}</strong><div class="hint">${item.status} · 使用版本 ${item.versions.map((version) => `v${version}`).join(', ')}</div></div>
                </div>
              `
            )
            .join('')
        : '<p class="hint">还没有问卷使用这道题。</p>'
    }
  `;
}

function renderOverallStats(overall) {
  if (!overall) return '<p class="hint">不同版本题型不一致，请查看分版本统计。</p>';
  if (overall.type === 'number') {
    return `<p>总体：${overall.answeredCount} 个回答，平均 ${overall.average ?? '-'}，最小 ${overall.min ?? '-'}，最大 ${overall.max ?? '-'}</p>`;
  }
  if (overall.type === 'text') {
    return `<p>总体：${overall.answeredCount} 个文本回答</p><div class="text-answers">${(overall.texts || []).map((text) => `<div class="text-answer">${escapeHtml(text)}</div>`).join('')}</div>`;
  }
  return `<p>总体：${overall.answeredCount} 个回答</p>${(overall.optionCounts || []).map((item) => `<div class="result-option"><div class="row space-between"><span>${escapeHtml(item.label)}</span><span class="hint">${item.count} · ${item.percentage}%</span></div></div>`).join('')}`;
}

async function showStats(familyId) {
  const data = await api(`/api/question-bank/${familyId}/stats`);
  bankDetail.classList.remove('hidden');
  bankDetail.innerHTML = `
    <div class="row space-between"><h3>跨问卷统计</h3><button class="secondary" data-action="close-detail" type="button">关闭</button></div>
    <p class="hint">${data.surveyCount} 个问卷 · ${data.responseCount} 份答卷 · ${data.versionsUsed} 个版本</p>
    ${renderOverallStats(data.overall)}
    <h4>分版本</h4>
    ${data.byVersion
      .map(
        (version) => `
          <div class="version-row">
            <div>
              <strong>v${version.version ?? '未知'} · ${escapeHtml(version.title)}</strong>
              <div class="hint">${version.answeredCount} 个回答</div>
            </div>
          </div>
        `
      )
      .join('')}
  `;
}

function bankQuestionPayload(question) {
  return {
    type: question.type,
    title: question.title,
    required: Boolean(question.required),
    options: (question.options || []).map((option) => ({ label: option.label })),
    validation: question.validation || {}
  };
}

async function shareBankQuestion(question) {
  const shared = await api('/api/shared-questions', {
    method: 'POST',
    body: {
      question: bankQuestionPayload(question),
      questionVersionId: question._id,
      questionFamilyId: question.familyId,
      questionVersion: question.version
    }
  });
  question.isShared = true;
  renderBank();
  message.className = 'success';
  message.innerHTML = `共享链接：<a href="${escapeHtml(shared.url)}" target="_blank" rel="noreferrer">${escapeHtml(shared.url)}</a>`;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(shared.url).catch(() => {});
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = '';
  const payload = buildPayload();
  if (!payload.title) {
    message.textContent = '请填写题干';
    return;
  }
  saveQuestionBtn.disabled = true;
  try {
    if (editing) {
      const created = await api(`/api/question-bank/${editing._id}/versions`, {
        method: 'POST',
        body: payload
      });
      message.textContent = '已创建新版本';
      if (createShareInput.checked) await shareBankQuestion(created);
    } else {
      const created = await api('/api/question-bank', { method: 'POST', body: payload });
      message.textContent = '题目已保存';
      if (createShareInput.checked) await shareBankQuestion(created);
    }
    resetForm();
    await loadBank();
  } catch (error) {
    message.className = 'error';
    message.textContent = error.message;
  } finally {
    saveQuestionBtn.disabled = false;
  }
});

typeInput.addEventListener('change', updateFormVisibility);
document.getElementById('resetFormBtn').addEventListener('click', resetForm);
document.getElementById('refreshBtn').addEventListener('click', loadBank);
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadBank, 250);
});
typeFilter.addEventListener('change', loadBank);

bankList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const item = button.closest('.bank-item');
  const id = item.dataset.id;
  const familyId = item.dataset.family;
  const question = bankQuestions.find((entry) => entry._id === id);
  if (!question) return;
  try {
    if (button.dataset.action === 'edit') fillForm(question);
    if (button.dataset.action === 'history') await showHistory(familyId);
    if (button.dataset.action === 'usages') await showUsages(familyId);
    if (button.dataset.action === 'stats') await showStats(familyId);
    if (button.dataset.action === 'share-link') await shareBankQuestion(question);
    if (button.dataset.action === 'derive') {
      await api(`/api/question-bank/${id}/derive`, { method: 'POST' });
      await loadBank();
    }
  } catch (error) {
    message.textContent = error.message;
  }
});

bankDetail.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  if (button.dataset.action === 'close-detail') {
    bankDetail.classList.add('hidden');
    return;
  }
  if (button.dataset.action === 'use-version') {
    location.assign(
      `/create?questionVersionId=${encodeURIComponent(button.dataset.id)}`
    );
    return;
  }
  if (button.dataset.action === 'restore') {
    try {
      await api(`/api/question-bank/${button.dataset.id}/restore`, { method: 'POST' });
      await loadBank();
      bankDetail.classList.add('hidden');
    } catch (error) {
      message.textContent = error.message;
    }
  }
});

async function boot() {
  if (!getToken()) {
    location.replace('/login');
    return;
  }
  try {
    const me = await api('/api/auth/me');
    currentUser = me.user;
    await loadBank();
  } catch (error) {
    if (error.status === 401) location.replace('/login');
    else message.textContent = error.message;
  }
}

updateFormVisibility();
boot();
