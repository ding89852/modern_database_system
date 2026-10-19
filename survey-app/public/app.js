import { api, escapeHtml, getToken, setToken } from '/api.js';

const userBox = document.getElementById('userBox');
const userName = document.getElementById('userName');
const listMessage = document.getElementById('listMessage');
const surveyList = document.getElementById('surveyList');
const sampleMessage = document.getElementById('sampleMessage');
let currentTab = 'published';

function statusText(status) {
  return { draft: '草稿', published: '已发布', closed: '已关闭' }[status] || status;
}

function surveyLink(slug) {
  return `${location.origin}/survey/${encodeURIComponent(slug)}`;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

function renderSurveys(items) {
  if (!items.length) {
    surveyList.innerHTML = '<p class="hint">还没有问卷。可以点上面的“创建并发布示例问卷”。</p>';
    return;
  }

  surveyList.innerHTML = items
    .map((survey) => {
      const link = survey.slug ? surveyLink(survey.slug) : '';
      const openButton =
        survey.status === 'published' && survey.slug
          ? `<a class="button-like" href="${link}" target="_blank" rel="noreferrer">打开填写页</a>`
          : '';
      const viewButton =
        survey.status === 'closed'
          ? `<a class="button-like secondary" href="/create?id=${survey.id}">查看问卷</a>`
          : '';
      const resultsButton =
        survey.status === 'published' || survey.status === 'closed'
          ? `<a class="button-like secondary" href="/results/${survey.id}">查看结果</a>`
          : '';
      const editButton =
        survey.status === 'draft'
          ? `<a class="button-like secondary" href="/create?id=${survey.id}">编辑</a>`
          : '';
      const publishButton =
        survey.status === 'draft'
          ? `<button class="secondary" data-action="publish" data-id="${survey.id}" type="button">发布</button>`
          : '';
      const closeButton =
        survey.status === 'published'
          ? `<button class="danger" data-action="close" data-id="${survey.id}" type="button">关闭问卷</button>`
          : '';
      const copyButton = survey.status === 'published' && survey.slug
        ? `<button class="secondary" data-action="copy" data-link="${link}" type="button">复制链接</button>`
        : '';

      return `
        <div class="survey-item">
          <h3>${escapeHtml(survey.title)}</h3>
          <div class="meta">
            ${statusText(survey.status)} · ${survey.questionCount} 题 · ${survey.responseCount} 份答卷
            ${survey.slug ? ` · slug: ${escapeHtml(survey.slug)}` : ''}
          </div>
          <div class="row">
            ${openButton}
            ${viewButton}
            ${resultsButton}
            ${editButton}
            ${publishButton}
            ${closeButton}
            ${copyButton}
          </div>
        </div>
      `;
    })
    .join('');
}

function renderFilledSurveys(items) {
  if (!items.length) {
    surveyList.innerHTML =
      '<p class="hint">还没有填写过问卷。匿名问卷不会出现在这里。</p>';
    return;
  }

  surveyList.innerHTML = items
    .map((item) => {
      const openButton =
        item.slug
          ? `<a class="button-like" href="/my-response/${encodeURIComponent(
              item.slug
            )}">查看填写内容</a>`
          : '';

      return `
        <div class="survey-item">
          <h3>${escapeHtml(item.title)}</h3>
          <div class="meta">
            ${statusText(item.status)} · 已提交 ${item.submissionCount} 次 · 最近提交 ${escapeHtml(
              formatDate(item.lastSubmittedAt)
            )}
            ${item.slug ? ` · slug: ${escapeHtml(item.slug)}` : ''}
          </div>
          <div class="row">${openButton}</div>
        </div>
      `;
    })
    .join('');
}

async function loadSurveys() {
  listMessage.textContent = '加载中...';
  try {
    const data =
      currentTab === 'filled'
        ? await api('/api/surveys/filled?pageSize=100')
        : await api('/api/surveys?pageSize=100');
    if (currentTab === 'filled') {
      renderFilledSurveys(data.items || []);
    } else {
      renderSurveys(data.items || []);
    }
    listMessage.textContent = `共 ${data.total ?? 0} 份问卷`;
  } catch (error) {
    if (error.status === 401) {
      setToken('');
      location.replace('/login');
      return;
    }
    listMessage.textContent = error.message;
  }
}

async function setTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tab);
  });
  await loadSurveys();
}

async function boot() {
  if (!getToken()) {
    location.replace('/login');
    return;
  }

  try {
    const data = await api('/api/auth/me');
    userBox.classList.remove('hidden');
    const registeredAt = formatDate(data.user.createdAt);
    userName.textContent = registeredAt
      ? `当前用户：${data.user.username} · 注册时间：${registeredAt}`
      : `当前用户：${data.user.username}`;
    document.getElementById('dashboard').classList.remove('hidden');
    await loadSurveys();
  } catch {
    setToken('');
    location.replace('/login');
  }
}

document.getElementById('logoutBtn').addEventListener('click', () => {
  setToken('');
  location.replace('/login');
});

document.getElementById('refreshBtn').addEventListener('click', loadSurveys);

document.querySelectorAll('.tab').forEach((button) => {
  button.addEventListener('click', () => setTab(button.dataset.tab));
});

document.getElementById('openSurveyBtn').addEventListener('click', () => {
  const value = document.getElementById('slugInput').value.trim();
  if (!value) return;
  let slug = value;
  try {
    if (/^https?:\/\//.test(value)) {
      const url = new URL(value);
      const parts = url.pathname.split('/').filter(Boolean);
      slug = parts[parts.length - 1] || '';
    } else {
      slug = value.replace(/^\/?survey\//, '').replace(/^\/+/, '');
    }
  } catch {
    slug = value;
  }
  if (slug) location.href = `/survey/${encodeURIComponent(slug)}`;
});

surveyList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  const id = button.dataset.id;

  try {
    if (action === 'copy') {
      await navigator.clipboard.writeText(button.dataset.link);
      button.textContent = '已复制';
      setTimeout(() => {
        button.textContent = '复制链接';
      }, 1200);
      return;
    }
    if (action === 'publish') {
      const published = await api(`/api/surveys/${id}/publish`, { method: 'POST' });
      listMessage.textContent = `已发布：${published.url}`;
    }
    if (action === 'close') {
      const confirmed = window.confirm(
        '确定关闭这份问卷吗？关闭后将不能再填写，也不能重新开放。'
      );
      if (!confirmed) return;
      await api(`/api/surveys/${id}/close`, { method: 'POST' });
      listMessage.textContent = '问卷已关闭';
    }
    await loadSurveys();
  } catch (error) {
    listMessage.textContent = error.message;
  }
});

document.getElementById('sampleBtn').addEventListener('click', async () => {
  sampleMessage.className = 'hint';
  sampleMessage.textContent = '正在创建示例问卷...';
  try {
    const survey = await api('/api/surveys', {
      method: 'POST',
      body: {
        title: '示例问卷：课程反馈',
        description: '这是系统自动创建的示例问卷，包含四种题型和一次精确匹配跳转。',
        allowAnonymous: false,
        allowMultipleResponses: false
      }
    });

    await api(`/api/surveys/${survey._id}/questions`, {
      method: 'POST',
      body: {
        type: 'single',
        title: '你的性别',
        required: true,
        options: [{ label: '男' }, { label: '女' }, { label: '其他' }]
      }
    });

    const q2 = await api(`/api/surveys/${survey._id}/questions`, {
      method: 'POST',
      body: {
        type: 'multiple',
        title: '你喜欢的水果',
        required: true,
        options: [
          { label: '苹果' },
          { label: '香蕉' },
          { label: '西瓜' },
          { label: '葡萄' }
        ],
        validation: { minSelections: 2, maxSelections: 3 }
      }
    });

    await api(`/api/surveys/${survey._id}/questions`, {
      method: 'POST',
      body: {
        type: 'text',
        title: '其他建议',
        required: false,
        validation: { minLength: 0, maxLength: 500 }
      }
    });

    const q4 = await api(`/api/surveys/${survey._id}/questions`, {
      method: 'POST',
      body: {
        type: 'number',
        title: '你的年龄',
        required: true,
        validation: { min: 0, max: 120, integer: true }
      }
    });

    await api(`/api/surveys/${survey._id}/questions/${q2._id}`, {
      method: 'PATCH',
      body: {
        jumpRules: [
          {
            priority: 1,
            when: {
              operator: 'setEq',
              value: [q2.options[0]._id, q2.options[3]._id]
            },
            target: { type: 'question', questionId: q4._id }
          }
        ]
      }
    });

    const published = await api(`/api/surveys/${survey._id}/publish`, { method: 'POST' });
    sampleMessage.className = 'success';
    sampleMessage.innerHTML = `示例问卷已发布：<a href="/survey/${encodeURIComponent(
      published.slug
    )}" target="_blank" rel="noreferrer">打开填写页</a>`;
    await setTab('published');
  } catch (error) {
    sampleMessage.className = 'error';
    sampleMessage.textContent = error.message;
  }
});

boot();
