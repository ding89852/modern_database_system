import { api, escapeHtml, getToken } from '/api.js';

const params = new URLSearchParams(location.search);
let surveyId = params.get('id') || null;
let questions = [];
let readOnly = false;
let saving = false;
let tempCounter = 0;

const meta = {
  title: '',
  description: '',
  allowAnonymous: false,
  allowMultipleResponses: false,
  deadline: ''
};

const pageTitle = document.getElementById('pageTitle');
const noticePanel = document.getElementById('noticePanel');
const noticeMessage = document.getElementById('noticeMessage');
const titleInput = document.getElementById('surveyTitleInput');
const descriptionInput = document.getElementById('surveyDescriptionInput');
const allowAnonymousInput = document.getElementById('allowAnonymousInput');
const allowMultipleResponsesInput = document.getElementById(
  'allowMultipleResponsesInput'
);
const deadlineInput = document.getElementById('deadlineInput');
const questionList = document.getElementById('questionList');
const addQuestionBtn = document.getElementById('addQuestionBtn');
const saveDraftBtn = document.getElementById('saveDraftBtn');
const savePublishBtn = document.getElementById('savePublishBtn');
const message = document.getElementById('message');

const typeLabels = {
  single: '单选',
  multiple: '多选',
  text: '文本填空',
  number: '数字填空'
};

function newClientId(prefix) {
  tempCounter += 1;
  return `${prefix}-${Date.now()}-${tempCounter}-${Math.random()
    .toString(16)
    .slice(2, 7)}`;
}

function isChoice(type) {
  return type === 'single' || type === 'multiple';
}

function rangeIsInvalid(min, max) {
  return min != null && max != null && max < min;
}

function defaultValidation(type) {
  if (type === 'multiple') {
    return { minSelections: null, maxSelections: null };
  }
  if (type === 'text') {
    return { minLength: null, maxLength: null };
  }
  if (type === 'number') {
    return { min: null, max: null, integer: false };
  }
  return {};
}

function newOption() {
  return { clientId: newClientId('opt'), id: null, label: '' };
}

function newQuestion(type = 'single') {
  return {
    clientId: newClientId('q'),
    id: null,
    type,
    title: '',
    required: false,
    options: isChoice(type) ? [newOption(), newOption()] : [],
    validation: defaultValidation(type),
    jumpRules: []
  };
}

function fromServerQuestion(question) {
  const options = (question.options || []).map((option) => ({
    clientId: option._id,
    id: option._id,
    label: option.label
  }));

  const jumpRules = (question.jumpRules || []).map((rule) => {
    let value = rule.when?.value;
    if (question.type === 'single') {
      value = options.find((option) => option.id === value)?.clientId || value;
    } else if (question.type === 'multiple') {
      value = (Array.isArray(value) ? value : []).map(
        (item) => options.find((option) => option.id === item)?.clientId || item
      );
    }
    return {
      priority: rule.priority,
      when: {
        operator: rule.when?.operator,
        value
      },
      target:
        rule.target?.type === 'question'
          ? { type: 'question', clientId: rule.target.questionId }
          : { type: 'end' }
    };
  });

  return {
    clientId: question._id,
    id: question._id,
    type: question.type,
    title: question.title,
    required: question.required,
    options,
    validation: { ...(question.validation || {}) },
    jumpRules
  };
}

function toLocalInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function deadlineToIso() {
  if (!meta.deadline) return null;
  const date = new Date(meta.deadline);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function nextMinuteLocal() {
  const date = new Date(Date.now() + 60 * 1000);
  return toLocalInput(date.toISOString());
}

function typeOptions(selected) {
  return Object.entries(typeLabels)
    .map(
      ([value, label]) =>
        `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`
    )
    .join('');
}

function renderOptions(question, index) {
  if (!isChoice(question.type)) return '';
  const rows = question.options
    .map(
      (option, optionIndex) => `
        <div class="option-row">
          <input
            data-field="option-label"
            data-option-index="${optionIndex}"
            value="${escapeHtml(option.label)}"
            placeholder="选项 ${optionIndex + 1}"
          />
          <button
            class="secondary"
            type="button"
            data-action="remove-option"
            data-option-index="${optionIndex}"
          >删除</button>
        </div>
      `
    )
    .join('');

  return `
    <div class="builder-section">
      <div class="row space-between">
        <label>选项</label>
        <button class="secondary" type="button" data-action="add-option">添加选项</button>
      </div>
      ${rows}
    </div>
  `;
}

function renderValidation(question) {
  if (question.type === 'multiple') {
    const minSelections = question.validation.minSelections;
    const maxSelections = question.validation.maxSelections;
    const invalidRange = rangeIsInvalid(minSelections, maxSelections);
    return `
      <div class="builder-section grid-2">
        <div class="field">
          <label>最少选择个数</label>
          <input type="number" min="0" data-field="minSelections"
            class="${invalidRange ? 'invalid' : ''}"
            value="${minSelections ?? ''}" placeholder="不限" />
        </div>
        <div class="field">
          <label>最多选择个数</label>
          <input type="number" min="0" data-field="maxSelections"
            class="${invalidRange ? 'invalid' : ''}"
            value="${maxSelections ?? ''}" placeholder="不限" />
        </div>
        <p class="field-error" data-range-error>${invalidRange ? '最多选择个数不能小于最少选择个数' : ''}</p>
      </div>
    `;
  }

  if (question.type === 'text') {
    const minLength = question.validation.minLength;
    const maxLength = question.validation.maxLength;
    const invalidRange = rangeIsInvalid(minLength, maxLength);
    return `
      <div class="builder-section grid-2">
        <div class="field">
          <label>最少字符数</label>
          <input type="number" min="0" data-field="minLength"
            class="${invalidRange ? 'invalid' : ''}"
            value="${minLength ?? ''}" placeholder="不限" />
        </div>
        <div class="field">
          <label>最多字符数</label>
          <input type="number" min="0" data-field="maxLength"
            class="${invalidRange ? 'invalid' : ''}"
            value="${maxLength ?? ''}" placeholder="不限" />
        </div>
        <p class="field-error" data-range-error>${invalidRange ? '最多字符数不能小于最少字符数' : ''}</p>
      </div>
    `;
  }

  if (question.type === 'number') {
    const minValue = question.validation.min;
    const maxValue = question.validation.max;
    const invalidRange = rangeIsInvalid(minValue, maxValue);
    return `
      <div class="builder-section">
        <div class="grid-2">
        <div class="field">
          <label>最小值</label>
          <input type="number" data-field="min"
            class="${invalidRange ? 'invalid' : ''}"
            value="${minValue ?? ''}" placeholder="不限" />
        </div>
        <div class="field">
          <label>最大值</label>
          <input type="number" data-field="max"
            class="${invalidRange ? 'invalid' : ''}"
            value="${maxValue ?? ''}" placeholder="不限" />
        </div>
        </div>
        <p class="field-error" data-range-error>${invalidRange ? '最大值不能小于最小值' : ''}</p>
        <div class="field">
          <label>数字类型</label>
          <select data-field="numberMode">
            <option value="decimal" ${question.validation.integer ? '' : 'selected'}>
              小数（允许整数和小数）
            </option>
            <option value="integer" ${question.validation.integer ? 'selected' : ''}>
              整数（只能填写整数）
            </option>
          </select>
        </div>
        <p class="hint">填写者只能输入发布者设置范围内的数字；小数模式允许整数和小数。</p>
      </div>
    `;
  }

  return '';
}

function targetOptions(index, rule) {
  const current =
    rule.target?.type === 'question' ? rule.target.clientId : '';
  const later = questions.slice(index + 1);
  const hasCurrent = later.some((question) => question.clientId === current);
  const options = [];

  options.push(
    `<option value="end" ${rule.target?.type === 'end' ? 'selected' : ''}>结束问卷</option>`
  );
  if (current && !hasCurrent) {
    options.push(
      `<option value="${escapeHtml(current)}" selected>（目标已失效，请重新选择）</option>`
    );
  }
  later.forEach((question, offset) => {
    options.push(
      `<option value="${escapeHtml(question.clientId)}" ${
        current === question.clientId ? 'selected' : ''
      }>第 ${index + 2 + offset} 题：${escapeHtml(question.title || '未命名')}</option>`
    );
  });

  return options.join('');
}

function renderRuleCondition(question, rule, ruleIndex) {
  if (question.type === 'single') {
    const current = rule.when?.value;
    const hasCurrent = question.options.some(
      (option) => option.clientId === current
    );
    return `
      <select data-field="rule-option" data-rule-index="${ruleIndex}">
        ${!hasCurrent ? '<option value="">请选择选项</option>' : ''}
        ${question.options
          .map(
            (option) =>
              `<option value="${escapeHtml(option.clientId)}" ${
                option.clientId === current ? 'selected' : ''
              }>${escapeHtml(option.label || '未命名选项')}</option>`
          )
          .join('')}
      </select>
    `;
  }

  if (question.type === 'multiple') {
    const selected = new Set(
      Array.isArray(rule.when?.value) ? rule.when.value : []
    );
    return `
      <div class="rule-options">
        ${question.options
          .map(
            (option) => `
              <label class="checkbox-line">
                <input type="checkbox" data-field="rule-set"
                  data-rule-index="${ruleIndex}"
                  value="${escapeHtml(option.clientId)}"
                  ${selected.has(option.clientId) ? 'checked' : ''} />
                ${escapeHtml(option.label || '未命名选项')}
              </label>
            `
          )
          .join('')}
      </div>
    `;
  }

  if (question.type === 'number') {
    const operator = rule.when?.operator || 'gte';
    const isBetween = operator === 'between';
    const value = rule.when?.value;
    return `
      <div class="row">
        <select data-field="rule-operator" data-rule-index="${ruleIndex}">
          ${[
            ['eq', '等于'],
            ['ne', '不等于'],
            ['gt', '大于'],
            ['gte', '大于等于'],
            ['lt', '小于'],
            ['lte', '小于等于'],
            ['between', '在区间内']
          ]
            .map(
              ([key, label]) =>
                `<option value="${key}" ${key === operator ? 'selected' : ''}>${label}</option>`
            )
            .join('')}
        </select>
        ${
          isBetween
            ? `
              <input type="number" data-field="rule-number-1" data-rule-index="${ruleIndex}"
                value="${Array.isArray(value) ? value[0] ?? '' : ''}" placeholder="下限" />
              <input type="number" data-field="rule-number-2" data-rule-index="${ruleIndex}"
                value="${Array.isArray(value) ? value[1] ?? '' : ''}" placeholder="上限" />
            `
            : `<input type="number" data-field="rule-number" data-rule-index="${ruleIndex}"
                value="${typeof value === 'number' ? value : ''}" placeholder="数值" />`
        }
      </div>
    `;
  }

  return '';
}

function renderJumpRules(question, index) {
  if (question.type === 'text') {
    return '<p class="hint">文本题暂不支持跳转规则。</p>';
  }

  const rules = question.jumpRules
    .map(
      (rule, ruleIndex) => `
        <div class="rule-box">
          <div class="grid-2">
            <div class="field">
              <label>条件</label>
              ${renderRuleCondition(question, rule, ruleIndex)}
            </div>
            <div class="field">
              <label>跳到</label>
              <select data-field="rule-target" data-rule-index="${ruleIndex}">
                ${targetOptions(index, rule)}
              </select>
            </div>
          </div>
          <button class="rule-delete" type="button" data-action="remove-rule"
            data-rule-index="${ruleIndex}">删除这条规则</button>
        </div>
      `
    )
    .join('');

  return `
    <div class="builder-section">
      <div class="row space-between">
        <label>跳转规则</label>
        <button class="secondary" type="button" data-action="add-rule">添加跳转规则</button>
      </div>
      ${rules || '<p class="hint">没有跳转规则时，按题目顺序进入下一题。</p>'}
    </div>
  `;
}

function renderQuestionCard(question, index) {
  return `
    <article class="question-card builder-question" data-index="${index}">
      <div class="row space-between">
        <strong>第 ${index + 1} 题</strong>
        <div class="row">
          <button class="secondary" type="button" data-action="move-up"
            ${index === 0 ? 'disabled' : ''}>上移</button>
          <button class="secondary" type="button" data-action="move-down"
            ${index === questions.length - 1 ? 'disabled' : ''}>下移</button>
          <button class="danger" type="button" data-action="delete-question">删除该题目</button>
        </div>
      </div>

      <div class="grid-2">
        <div class="field">
          <label>题型</label>
          <select data-field="type">${typeOptions(question.type)}</select>
        </div>
        <div class="field">
          <label>题干</label>
          <input data-field="title" value="${escapeHtml(question.title)}"
            placeholder="请输入题干" />
        </div>
      </div>

      <label class="checkbox-line">
        <input type="checkbox" data-field="required" ${question.required ? 'checked' : ''} />
        必答
      </label>

      ${renderOptions(question, index)}
      ${renderValidation(question)}
      ${renderJumpRules(question, index)}
    </article>
  `;
}

function render() {
  pageTitle.textContent = readOnly
    ? '查看问卷（只读）'
    : surveyId
      ? '编辑问卷'
      : '创建问卷';
  titleInput.value = meta.title;
  descriptionInput.value = meta.description;
  allowAnonymousInput.checked = meta.allowAnonymous;
  allowMultipleResponsesInput.checked = meta.allowMultipleResponses;
  deadlineInput.value = meta.deadline;
  deadlineInput.min = nextMinuteLocal();

  if (!questions.length) {
    questionList.innerHTML = '<p class="hint">还没有题目，点“添加题目”开始。</p>';
  } else {
    questionList.innerHTML = questions
      .map((question, index) => renderQuestionCard(question, index))
      .join('');
  }

  questions.forEach((question, index) => {
    const card = questionList.querySelector(
      `.builder-question[data-index="${index}"]`
    );
    if (card) applyRangeValidation(question, card);
  });

  if (readOnly) {
    questionList
      .querySelectorAll('input, select, textarea, button')
      .forEach((element) => {
        element.disabled = true;
      });
    addQuestionBtn.disabled = true;
    saveDraftBtn.disabled = true;
    savePublishBtn.disabled = true;
    titleInput.disabled = true;
    descriptionInput.disabled = true;
    allowAnonymousInput.disabled = true;
    allowMultipleResponsesInput.disabled = true;
    deadlineInput.disabled = true;
  }
  setSaving(saving);
}

function defaultRule(question) {
  if (question.type === 'single') {
    return {
      priority: question.jumpRules.length + 1,
      when: {
        operator: 'eq',
        value: question.options[0]?.clientId || ''
      },
      target: { type: 'end' }
    };
  }
  if (question.type === 'multiple') {
    return {
      priority: question.jumpRules.length + 1,
      when: { operator: 'setEq', value: [] },
      target: { type: 'end' }
    };
  }
  return {
    priority: question.jumpRules.length + 1,
    when: { operator: 'gte', value: 0 },
    target: { type: 'end' }
  };
}

function cleanRules(question, removedOptionId) {
  question.jumpRules = question.jumpRules.filter((rule) => {
    if (question.type === 'single') {
      return rule.when.value !== removedOptionId;
    }
    if (question.type === 'multiple') {
      rule.when.value = (rule.when.value || []).filter(
        (value) => value !== removedOptionId
      );
      return rule.when.value.length > 0;
    }
    return true;
  });
}

function validateBuilder(publish) {
  if (!meta.title.trim()) return '请填写问卷标题';
  if (meta.deadline) {
    const deadline = new Date(meta.deadline);
    if (Number.isNaN(deadline.getTime())) return '截止时间格式不合法';
    if (deadline.getTime() <= Date.now()) return '截止时间必须晚于当前时间';
  }
  if (publish && questions.length === 0) return '至少添加一道题目';

  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index];
    const prefix = `第 ${index + 1} 题`;
    if (!question.title.trim()) return `${prefix}缺少题干`;

    if (isChoice(question.type)) {
      if (question.options.length < 2) return `${prefix}至少需要两个选项`;
      if (question.options.some((option) => !option.label.trim())) {
        return `${prefix}存在空选项`;
      }
    }

    if (question.type === 'multiple') {
      const min = question.validation.minSelections;
      const max = question.validation.maxSelections;
      if (min != null && (!Number.isInteger(min) || min < 0)) {
        return `${prefix}的最少选择个数必须是非负整数`;
      }
      if (max != null && (!Number.isInteger(max) || max < 0)) {
        return `${prefix}的最多选择个数必须是非负整数`;
      }
      if (min != null && max != null && min > max) {
        return `${prefix}的最多选择个数不能小于最少选择个数`;
      }
      if (max != null && max > question.options.length) {
        return `${prefix}的最多选择个数不能超过选项总数`;
      }
    }

    if (question.type === 'text') {
      const min = question.validation.minLength;
      const max = question.validation.maxLength;
      if (min != null && (!Number.isInteger(min) || min < 0)) {
        return `${prefix}的最少字符数必须是非负整数`;
      }
      if (max != null && (!Number.isInteger(max) || max < 0)) {
        return `${prefix}的最多字符数必须是非负整数`;
      }
      if (min != null && max != null && min > max) {
        return `${prefix}的最多字符数不能小于最少字符数`;
      }
    }

    if (question.type === 'number') {
      const min = question.validation.min;
      const max = question.validation.max;
      if (min != null && !Number.isFinite(min)) return `${prefix}的最小值不合法`;
      if (max != null && !Number.isFinite(max)) return `${prefix}的最大值不合法`;
      if (min != null && max != null && min > max) {
        return `${prefix}的最大值不能小于最小值`;
      }
    }

    for (const rule of question.jumpRules) {
      if (question.type === 'single') {
        const exists = question.options.some(
          (option) => option.clientId === rule.when.value
        );
        if (!exists) return `${prefix}的跳转条件缺少选项`;
      }
      if (question.type === 'multiple') {
        if (!Array.isArray(rule.when.value) || rule.when.value.length === 0) {
          return `${prefix}的多选跳转必须选择至少一个选项`;
        }
        const optionIds = new Set(
          question.options.map((option) => option.clientId)
        );
        if (rule.when.value.some((value) => !optionIds.has(value))) {
          return `${prefix}的跳转条件包含已删除的选项`;
        }
        const min = question.validation.minSelections;
        const max = question.validation.maxSelections;
        if (min != null && rule.when.value.length < min) {
          return `${prefix}的跳转集合小于最少选择个数，永远不会命中`;
        }
        if (max != null && rule.when.value.length > max) {
          return `${prefix}的跳转集合大于最多选择个数，永远不会命中`;
        }
      }
      if (question.type === 'number') {
        if (Array.isArray(rule.when.value)) {
          if (
            rule.when.value.length !== 2 ||
            rule.when.value.some((value) => !Number.isFinite(value))
          ) {
            return `${prefix}的区间跳转需要两个合法数字`;
          }
          if (rule.when.value[0] > rule.when.value[1]) {
            return `${prefix}的区间下限不能大于上限`;
          }
        } else if (!Number.isFinite(rule.when.value)) {
          return `${prefix}的跳转条件必须是合法数字`;
        }
      }
      if (rule.target.type === 'question') {
        const targetIndex = questions.findIndex(
          (item) => item.clientId === rule.target.clientId
        );
        if (targetIndex < 0) {
          return `${prefix}的跳转目标题目已删除，请重新选择`;
        }
        if (targetIndex <= index) {
          return `${prefix}的跳转目标必须是后面的题目`;
        }
      }
    }
  }

  return '';
}

function applyRangeValidation(question, card) {
  const config = {
    multiple: ['minSelections', 'maxSelections', '最多选择个数不能小于最少选择个数'],
    text: ['minLength', 'maxLength', '最多字符数不能小于最少字符数'],
    number: ['min', 'max', '最大值不能小于最小值']
  }[question.type];

  if (!config) return true;

  const [minField, maxField, message] = config;
  const minInput = card.querySelector(`[data-field="${minField}"]`);
  const maxInput = card.querySelector(`[data-field="${maxField}"]`);
  if (!minInput || !maxInput) return true;

  const min = minInput.value === '' ? null : Number(minInput.value);
  const max = maxInput.value === '' ? null : Number(maxInput.value);
  const invalid = rangeIsInvalid(min, max);

  if (min != null && !Number.isNaN(min)) maxInput.min = String(min);
  else maxInput.removeAttribute('min');
  if (max != null && !Number.isNaN(max)) minInput.max = String(max);
  else minInput.removeAttribute('max');

  minInput.classList.toggle('invalid', invalid);
  maxInput.classList.toggle('invalid', invalid);
  const error = card.querySelector('[data-range-error]');
  if (error) error.textContent = invalid ? message : '';
  card.dataset.rangeInvalid = invalid ? '1' : '0';
  return !invalid;
}

function hasRangeErrors() {
  return [...questionList.querySelectorAll('.builder-question')].some(
    (card) => card.dataset.rangeInvalid === '1'
  );
}

function buildPayload() {
  return {
    questions: questions.map((question, index) => ({
      clientId: question.clientId,
      ...(question.id ? { id: question.id } : {}),
      type: question.type,
      title: question.title.trim(),
      required: Boolean(question.required),
      options: isChoice(question.type)
        ? question.options.map((option) => ({
            clientId: option.clientId,
            ...(option.id ? { id: option.id } : {}),
            label: option.label.trim()
          }))
        : [],
      validation: question.validation,
      jumpRules: question.jumpRules.map((rule, ruleIndex) => ({
        priority: ruleIndex + 1,
        when: {
          operator: rule.when.operator,
          value: rule.when.value
        },
        target:
          rule.target.type === 'question'
            ? { type: 'question', clientId: rule.target.clientId }
            : { type: 'end' }
      }))
    }))
  };
}

function setSaving(value) {
  saving = value;
  const blocked = value || readOnly || hasRangeErrors();
  saveDraftBtn.disabled = blocked;
  savePublishBtn.disabled = blocked;
  saveDraftBtn.textContent = value ? '保存中...' : '保存草稿';
  savePublishBtn.textContent = value ? '保存中...' : '保存并发布';
}

async function loadSurveyData() {
  const survey = await api(`/api/surveys/${surveyId}`);
  readOnly = survey.status !== 'draft';
  meta.title = survey.title || '';
  meta.description = survey.description || '';
  meta.allowAnonymous = Boolean(survey.allowAnonymous);
  meta.allowMultipleResponses = Boolean(survey.allowMultipleResponses);
  meta.deadline = toLocalInput(survey.deadline);
  questions = (survey.questions || []).map(fromServerQuestion);
  if (!questions.length) questions = [newQuestion('single')];
  if (readOnly) {
    noticePanel.classList.remove('hidden');
    noticeMessage.textContent = '问卷已发布或已关闭，不能继续编辑。';
  }
  render();
}

async function load() {
  if (!getToken()) {
    location.replace('/login');
    return;
  }
  if (!surveyId) {
    questions = [newQuestion('single')];
    render();
    return;
  }
  try {
    await loadSurveyData();
  } catch (error) {
    if (error.status === 401) {
      location.replace('/login');
      return;
    }
    noticePanel.classList.remove('hidden');
    noticeMessage.textContent = error.message;
    readOnly = true;
    render();
  }
}

async function save(publish) {
  if (saving || readOnly) return;
  message.className = 'error';
  message.textContent = '';

  const error = validateBuilder(publish);
  if (error) {
    message.textContent = error;
    return;
  }

  setSaving(true);
  try {
    const body = {
      title: meta.title.trim(),
      description: meta.description.trim(),
      allowAnonymous: meta.allowAnonymous,
      allowMultipleResponses: meta.allowMultipleResponses,
      deadline: deadlineToIso()
    };

    if (!surveyId) {
      const created = await api('/api/surveys', { method: 'POST', body });
      surveyId = created._id;
      history.replaceState(null, '', `/create?id=${surveyId}`);
    } else {
      await api(`/api/surveys/${surveyId}`, { method: 'PATCH', body });
    }

    await api(`/api/surveys/${surveyId}/questions`, {
      method: 'PUT',
      body: buildPayload()
    });

    if (publish) {
      const published = await api(`/api/surveys/${surveyId}/publish`, {
        method: 'POST'
      });
      readOnly = true;
      noticePanel.classList.remove('hidden');
      noticeMessage.className = 'success';
      noticeMessage.innerHTML = `问卷已发布：<a href="/survey/${encodeURIComponent(
        published.slug
      )}" target="_blank" rel="noreferrer">打开填写页</a>`;
      message.className = 'success';
      message.textContent = '发布成功，可以回到首页查看答卷统计。';
      render();
    } else {
      await loadSurveyData();
      message.className = 'success';
      message.textContent = '草稿已保存';
    }
  } catch (error) {
    message.className = 'error';
    message.textContent = error.message;
  } finally {
    setSaving(false);
  }
}

titleInput.addEventListener('input', () => {
  meta.title = titleInput.value;
});
descriptionInput.addEventListener('input', () => {
  meta.description = descriptionInput.value;
});
allowAnonymousInput.addEventListener('change', () => {
  meta.allowAnonymous = allowAnonymousInput.checked;
});
allowMultipleResponsesInput.addEventListener('change', () => {
  meta.allowMultipleResponses = allowMultipleResponsesInput.checked;
});
deadlineInput.addEventListener('input', () => {
  meta.deadline = deadlineInput.value;
});
deadlineInput.addEventListener('focus', () => {
  deadlineInput.min = nextMinuteLocal();
});

addQuestionBtn.addEventListener('click', () => {
  if (readOnly) return;
  questions.push(newQuestion('single'));
  render();
  questionList.lastElementChild?.scrollIntoView({
    behavior: 'smooth',
    block: 'center'
  });
});

questionList.addEventListener('input', (event) => {
  const field = event.target.dataset.field;
  if (!field) return;
  const card = event.target.closest('.builder-question');
  if (!card) return;
  const index = Number(card.dataset.index);
  const question = questions[index];

  if (field === 'title') {
    question.title = event.target.value;
  } else if (field === 'option-label') {
    const optionIndex = Number(event.target.dataset.optionIndex);
    question.options[optionIndex].label = event.target.value;
  } else if (
    ['minSelections', 'maxSelections', 'minLength', 'maxLength', 'min', 'max'].includes(
      field
    )
  ) {
    question.validation[field] =
      event.target.value === '' ? null : Number(event.target.value);
  } else if (field === 'rule-number') {
    const ruleIndex = Number(event.target.dataset.ruleIndex);
    question.jumpRules[ruleIndex].when.value = Number(event.target.value);
  } else if (field === 'rule-number-1' || field === 'rule-number-2') {
    const ruleIndex = Number(event.target.dataset.ruleIndex);
    const rule = question.jumpRules[ruleIndex];
    if (!Array.isArray(rule.when.value)) rule.when.value = [0, 0];
    const position = field === 'rule-number-1' ? 0 : 1;
    rule.when.value[position] = Number(event.target.value);
  }

  applyRangeValidation(question, card);
  setSaving(saving);
});

questionList.addEventListener('change', (event) => {
  const field = event.target.dataset.field;
  if (!field) return;
  const card = event.target.closest('.builder-question');
  if (!card) return;
  const index = Number(card.dataset.index);
  const question = questions[index];

  if (field === 'type') {
    question.type = event.target.value;
    question.validation = defaultValidation(question.type);
    question.jumpRules = [];
    if (isChoice(question.type) && question.options.length < 2) {
      question.options = [newOption(), newOption()];
    }
    if (!isChoice(question.type)) question.options = [];
    render();
  } else if (field === 'required') {
    question.required = event.target.checked;
  } else if (field === 'numberMode') {
    question.validation.integer = event.target.value === 'integer';
  } else if (field === 'rule-option') {
    const ruleIndex = Number(event.target.dataset.ruleIndex);
    question.jumpRules[ruleIndex].when.value = event.target.value;
  } else if (field === 'rule-operator') {
    const ruleIndex = Number(event.target.dataset.ruleIndex);
    const rule = question.jumpRules[ruleIndex];
    rule.when.operator = event.target.value;
    rule.when.value = event.target.value === 'between' ? [0, 0] : 0;
    render();
  } else if (field === 'rule-target') {
    const ruleIndex = Number(event.target.dataset.ruleIndex);
    question.jumpRules[ruleIndex].target =
      event.target.value === 'end'
        ? { type: 'end' }
        : { type: 'question', clientId: event.target.value };
  } else if (field === 'rule-set') {
    const ruleIndex = Number(event.target.dataset.ruleIndex);
    const values = [
      ...card.querySelectorAll(
        `input[data-field="rule-set"][data-rule-index="${ruleIndex}"]:checked`
      )
    ].map((input) => input.value);
    question.jumpRules[ruleIndex].when.value = values;
  }
});

questionList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const card = button.closest('.builder-question');
  if (!card) return;
  const index = Number(card.dataset.index);
  const question = questions[index];
  const action = button.dataset.action;

  if (action === 'move-up' && index > 0) {
    [questions[index - 1], questions[index]] = [
      questions[index],
      questions[index - 1]
    ];
    render();
  } else if (action === 'move-down' && index < questions.length - 1) {
    [questions[index + 1], questions[index]] = [
      questions[index],
      questions[index + 1]
    ];
    render();
  } else if (action === 'delete-question') {
    const [removed] = questions.splice(index, 1);
    for (const item of questions) {
      item.jumpRules = item.jumpRules.filter(
        (rule) =>
          rule.target.type !== 'question' ||
          rule.target.clientId !== removed.clientId
      );
    }
    render();
  } else if (action === 'add-option') {
    question.options.push(newOption());
    render();
  } else if (action === 'remove-option') {
    if (question.options.length <= 2) {
      message.className = 'error';
      message.textContent = '选择题至少保留两个选项';
      return;
    }
    const optionIndex = Number(button.dataset.optionIndex);
    const [removed] = question.options.splice(optionIndex, 1);
    cleanRules(question, removed.clientId);
    render();
  } else if (action === 'add-rule') {
    question.jumpRules.push(defaultRule(question));
    render();
  } else if (action === 'remove-rule') {
    const ruleIndex = Number(button.dataset.ruleIndex);
    question.jumpRules.splice(ruleIndex, 1);
    render();
  }
});

saveDraftBtn.addEventListener('click', () => save(false));
savePublishBtn.addEventListener('click', () => save(true));

load();
