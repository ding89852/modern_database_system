import { api, escapeHtml, getToken } from '/api.js';

const slug = decodeURIComponent(
  location.pathname.split('/').filter(Boolean).pop() || ''
);

const titleElement = document.getElementById('surveyTitle');
const descriptionElement = document.getElementById('surveyDescription');
const metaElement = document.getElementById('surveyMeta');
const messagePanel = document.getElementById('messagePanel');
const pageMessage = document.getElementById('pageMessage');
const responsePanel = document.getElementById('responsePanel');
const responseList = document.getElementById('responseList');

function showMessage(message) {
  messagePanel.classList.remove('hidden');
  pageMessage.textContent = message;
  responsePanel.classList.add('hidden');
}

function optionById(question, optionId) {
  return (question.options || []).find((option) => option._id === optionId);
}

function answerValue(question, answer) {
  if (!answer) return null;

  if (question.type === 'single') {
    const option = optionById(question, answer.value);
    return option ? option.label : '(选项已删除)';
  }

  if (question.type === 'multiple') {
    const values = Array.isArray(answer.value) ? answer.value : [];
    const labels = values
      .map((value) => optionById(question, value)?.label)
      .filter(Boolean);
    return labels.length ? labels : '(选项已删除)';
  }

  return answer.value;
}

function renderQuestion(question, answer) {
  const value = answerValue(question, answer);
  let content = '';

  if (!answer) {
    content = '<p class="hint">未作答（本题被跳过或未填写）</p>';
  } else if (question.type === 'single' || question.type === 'multiple') {
    const selected = new Set(
      question.type === 'single'
        ? [answer.value]
        : Array.isArray(answer.value)
          ? answer.value
          : []
    );
    content = `
      <div class="readonly-options">
        ${(question.options || [])
          .map(
            (option) => `
              <label class="option">
                <input
                  type="${question.type === 'single' ? 'radio' : 'checkbox'}"
                  disabled
                  ${selected.has(option._id) ? 'checked' : ''}
                />
                <span>${escapeHtml(option.label)}</span>
              </label>
            `
          )
          .join('')}
      </div>
    `;
  } else if (question.type === 'text') {
    content = `<textarea disabled>${escapeHtml(value ?? '')}</textarea>`;
  } else {
    content = `<input disabled value="${escapeHtml(value ?? '')}" />`;
  }

  return `
    <div class="readonly-question">
      <h4>${escapeHtml(question.title)}</h4>
      ${content}
    </div>
  `;
}

function renderResponses(survey, responses) {
  titleElement.textContent = survey.title;
  descriptionElement.textContent = survey.description || '';
  metaElement.textContent = `${responses.length} 次提交 · 只读查看`;

  if (!responses.length) {
    showMessage('没有找到你的答卷。匿名问卷不会显示在这里。');
    return;
  }

  messagePanel.classList.add('hidden');
  responsePanel.classList.remove('hidden');

  const questions = [...(survey.questions || [])].sort(
    (a, b) => a.order - b.order
  );

  responseList.innerHTML = responses
    .map((response, index) => {
      const answers = new Map(
        (response.answers || []).map((answer) => [answer.questionId, answer])
      );
      return `
        <section class="card response-card">
          <div class="row space-between">
            <h2>第 ${index + 1} 次提交</h2>
            <span class="hint">${new Date(response.submittedAt).toLocaleString()}</span>
          </div>
          ${questions
            .map((question) => renderQuestion(question, answers.get(question._id)))
            .join('')}
        </section>
      `;
    })
    .join('');
}

async function load() {
  if (!getToken()) {
    location.replace('/login');
    return;
  }

  try {
    const data = await api(
      `/api/fill/surveys/${encodeURIComponent(slug)}/my-responses`
    );
    renderResponses(data.survey, data.responses || []);
  } catch (error) {
    if (error.status === 401) {
      location.replace('/login');
      return;
    }
    showMessage(error.message);
  }
}

load();
