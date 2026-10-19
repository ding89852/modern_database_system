import { api, escapeHtml, getToken } from '/api.js';

const surveyId = decodeURIComponent(
  location.pathname.split('/').filter(Boolean).pop() || ''
);

const titleElement = document.getElementById('surveyTitle');
const descriptionElement = document.getElementById('surveyDescription');
const metaElement = document.getElementById('surveyMeta');
const messagePanel = document.getElementById('messagePanel');
const pageMessage = document.getElementById('pageMessage');
const resultContent = document.getElementById('resultContent');
const totalResponsesElement = document.getElementById('totalResponses');
const questionCountElement = document.getElementById('questionCount');
const surveyStatusElement = document.getElementById('surveyStatus');
const statsList = document.getElementById('statsList');
const responseList = document.getElementById('responseList');
const respondentList = document.getElementById('respondentList');
const respondentCount = document.getElementById('respondentCount');
const statsPanel = document.getElementById('statsPanel');
const responsesPanel = document.getElementById('responsesPanel');

function statusText(status) {
  return { draft: '草稿', published: '已发布', closed: '已关闭' }[status] || status;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

function optionLabel(question, optionId) {
  const option = (question.options || []).find(
    (item) => item._id === optionId
  );
  return option?.label || '(选项已删除)';
}

function answerText(question, answer) {
  if (!answer) return '未作答';
  if (question.type === 'single') return optionLabel(question, answer.value);
  if (question.type === 'multiple') {
    const values = Array.isArray(answer.value) ? answer.value : [];
    return values.map((value) => optionLabel(question, value)).join('、');
  }
  return String(answer.value ?? '');
}

function renderStats(stats) {
  if (!stats.questions.length) {
    statsList.innerHTML = '<p class="hint">还没有题目。</p>';
    return;
  }

  statsList.innerHTML = stats.questions
    .map((question) => {
      let content = '';

      if (question.type === 'single' || question.type === 'multiple') {
        content = (question.options || [])
          .map(
            (option) => `
              <div class="result-option">
                <div class="row space-between">
                  <span>${escapeHtml(option.label)}</span>
                  <span class="hint">${option.count} 人 · ${option.percentage}%</span>
                </div>
                <div class="result-bar">
                  <span style="width: ${Math.min(option.percentage, 100)}%"></span>
                </div>
              </div>
            `
          )
          .join('');
      } else if (question.type === 'text') {
        content = `
          <p class="hint">共 ${question.answersTotal ?? question.answeredCount} 条文本回答</p>
          ${
            (question.answers || []).length
              ? `<div class="text-answers">${question.answers
                  .map((answer) => `<div class="text-answer">${escapeHtml(answer)}</div>`)
                  .join('')}</div>`
              : '<p class="hint">暂无回答。</p>'
          }
        `;
      } else {
        content = `
          <div class="stats-grid">
            <div><div class="stat-value">${question.answeredCount}</div><div class="hint">回答人数</div></div>
            <div><div class="stat-value">${question.average ?? '-'}</div><div class="hint">平均值</div></div>
            <div><div class="stat-value">${question.min ?? '-'}</div><div class="hint">最小值</div></div>
            <div><div class="stat-value">${question.max ?? '-'}</div><div class="hint">最大值</div></div>
          </div>
        `;
      }

      return `
        <article class="result-question">
          <div class="row space-between">
            <h3>${escapeHtml(question.title)}</h3>
            <span class="hint">${question.answeredCount} 人回答</span>
          </div>
          ${content}
        </article>
      `;
    })
    .join('');
}

function renderResponses(survey, responses) {
  if (!responses.length) {
    responseList.innerHTML = '<p class="hint">还没有答卷。</p>';
    return;
  }

  const questions = [...(survey.questions || [])].sort(
    (a, b) => a.order - b.order
  );

  responseList.innerHTML = responses
    .map((response, index) => {
      const answers = new Map(
        (response.answers || []).map((answer) => [answer.questionId, answer])
      );
      const respondent = response.respondent?.username
        ? `用户：${response.respondent.username}`
        : response.anonymous
          ? '匿名填写'
          : '未知用户';

      return `
        <article class="result-question response-card" data-response-index="${index}">
          <div class="row space-between">
            <h3>第 ${index + 1} 份答卷</h3>
            <span class="hint">${escapeHtml(respondent)} · ${escapeHtml(
              formatDate(response.submittedAt)
            )}</span>
          </div>
          ${questions
            .map((question) => {
              const answer = answers.get(question._id);
              return `
                <div class="response-answer">
                  <div class="response-question">${escapeHtml(question.title)}</div>
                  <div>${escapeHtml(answerText(question, answer))}</div>
                </div>
              `;
            })
            .join('')}
        </article>
      `;
    })
    .join('');
}

function renderRespondents(survey, responses) {
  respondentCount.textContent = `${responses.length} 份`;
  if (!responses.length) {
    respondentList.innerHTML = '<p class="hint">还没有人作答。</p>';
    return;
  }

  const anonymousHint = survey.allowAnonymous
    ? '<p class="hint">该问卷设置为匿名填写，只能看到匿名填写记录，无法查看具体用户。</p>'
    : '';

  respondentList.innerHTML = `
    ${anonymousHint}
    ${responses
      .map((response, index) => {
        const name = response.respondent?.username
          ? `用户：${response.respondent.username}`
          : response.anonymous
            ? '匿名填写'
            : '未知用户';
        return `
          <div class="respondent-row">
            <div>
              <strong>${escapeHtml(name)}</strong>
              <div class="hint">第 ${index + 1} 份 · ${escapeHtml(
                formatDate(response.submittedAt)
              )}</div>
            </div>
            <button class="secondary" type="button" data-response-index="${index}">
              查看答案
            </button>
          </div>
        `;
      })
      .join('')}
  `;
}

async function loadAllResponses() {
  const items = [];
  let page = 1;
  let total = 0;

  while (true) {
    const data = await api(
      `/api/surveys/${encodeURIComponent(surveyId)}/responses?page=${page}&pageSize=100`
    );
    items.push(...(data.items || []));
    total = data.total ?? items.length;
    if (items.length >= total || !(data.items || []).length) break;
    page += 1;
  }

  return { items, total };
}

async function load() {
  if (!getToken()) {
    location.replace('/login');
    return;
  }

  try {
    const [survey, stats, responseData] = await Promise.all([
      api(`/api/surveys/${encodeURIComponent(surveyId)}`),
      api(`/api/surveys/${encodeURIComponent(surveyId)}/stats`),
      loadAllResponses()
    ]);

    titleElement.textContent = survey.title;
    descriptionElement.textContent = survey.description || '';
    metaElement.textContent = `slug: ${survey.slug || '-'}`;
    totalResponsesElement.textContent = stats.totalResponses ?? responseData.total;
    questionCountElement.textContent = (survey.questions || []).length;
    surveyStatusElement.textContent = statusText(survey.status);

    renderStats(stats);
    renderResponses(survey, responseData.items);
    renderRespondents(survey, responseData.items);
    resultContent.classList.remove('hidden');
  } catch (error) {
    if (error.status === 401) {
      location.replace('/login');
      return;
    }
    messagePanel.classList.remove('hidden');
    pageMessage.textContent = error.message;
  }
}

function showTab(tab) {
  document.querySelectorAll('.tab').forEach((item) => {
    item.classList.toggle('active', item.dataset.tab === tab);
  });
  const showStats = tab === 'stats';
  statsPanel.classList.toggle('hidden', !showStats);
  responsesPanel.classList.toggle('hidden', showStats);
}

document.querySelectorAll('.tab').forEach((button) => {
  button.addEventListener('click', () => showTab(button.dataset.tab));
});

respondentList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-response-index]');
  if (!button) return;
  showTab('responses');
  const index = button.dataset.responseIndex;
  const target = responseList.querySelector(
    `.response-card[data-response-index="${index}"]`
  );
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

load();
