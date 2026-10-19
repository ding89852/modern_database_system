import { createHash } from 'node:crypto';
import { AppError } from './errors.js';

export const QUESTION_TYPES = ['single', 'multiple', 'text', 'number'];

export function idOf(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value.toHexString === 'function') return value.toHexString();
  return String(value);
}

export function codePointLength(value) {
  return Array.from(value).length;
}

export function hasAnswer(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function optionIdSet(question) {
  return new Set((question.options || []).map((option) => idOf(option._id)));
}

function invalidAnswer(question, message) {
  throw new AppError(422, 'ANSWER_INVALID', message, {
    questionId: idOf(question._id)
  });
}

function invalidJump(message, details) {
  throw new AppError(422, 'JUMP_INVALID', message, details);
}

export function validateAnswer(question, value) {
  const validation = question.validation || {};

  switch (question.type) {
    case 'single': {
      if (!optionIdSet(question).has(idOf(value))) {
        invalidAnswer(question, '单选答案必须是该题的一个选项');
      }
      break;
    }

    case 'multiple': {
      if (!Array.isArray(value) || value.length === 0) {
        invalidAnswer(question, '多选题至少选择 1 个选项');
      }
      const selected = value.map(idOf);
      if (new Set(selected).size !== selected.length) {
        invalidAnswer(question, '多选题答案不能包含重复选项');
      }
      const allowed = optionIdSet(question);
      for (const optionId of selected) {
        if (!allowed.has(optionId)) {
          invalidAnswer(question, '存在不属于该题的选项');
        }
      }
      if (validation.minSelections != null && selected.length < validation.minSelections) {
        invalidAnswer(question, `至少选择 ${validation.minSelections} 个选项`);
      }
      if (validation.maxSelections != null && selected.length > validation.maxSelections) {
        invalidAnswer(question, `最多选择 ${validation.maxSelections} 个选项`);
      }
      break;
    }

    case 'text': {
      if (typeof value !== 'string') {
        invalidAnswer(question, '文本题答案必须是字符串');
      }
      if (value.trim().length === 0) {
        invalidAnswer(question, '文本答案不能为空');
      }
      const length = codePointLength(value);
      if (validation.minLength != null && length < validation.minLength) {
        invalidAnswer(question, `至少输入 ${validation.minLength} 个字符`);
      }
      if (validation.maxLength != null && length > validation.maxLength) {
        invalidAnswer(question, `最多输入 ${validation.maxLength} 个字符`);
      }
      break;
    }

    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        invalidAnswer(question, '数字题答案必须是合法数字');
      }
      if (validation.integer && !Number.isInteger(value)) {
        invalidAnswer(question, '该题要求填写整数');
      }
      if (validation.min != null && value < validation.min) {
        invalidAnswer(question, `数值不能小于 ${validation.min}`);
      }
      if (validation.max != null && value > validation.max) {
        invalidAnswer(question, `数值不能大于 ${validation.max}`);
      }
      break;
    }

    default:
      invalidAnswer(question, '未知题型');
  }

  return true;
}

export function evaluateWhen(question, when, value) {
  const operator = when?.operator;

  switch (question.type) {
    case 'single': {
      if (operator !== 'eq') {
        invalidJump('单选题只支持 eq 跳转条件', { operator });
      }
      return idOf(value) === idOf(when.value);
    }

    case 'multiple': {
      if (operator !== 'setEq') {
        invalidJump('多选题只支持 setEq 精确匹配', { operator });
      }
      if (!Array.isArray(value) || !Array.isArray(when.value)) {
        invalidJump('setEq 的答案和配置值都必须是数组');
      }
      const actual = new Set(value.map(idOf));
      const expected = new Set(when.value.map(idOf));
      if (actual.size !== expected.size) return false;
      for (const optionId of actual) {
        if (!expected.has(optionId)) return false;
      }
      return true;
    }

    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        invalidJump('数字跳转的答案必须是合法数字');
      }
      switch (operator) {
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
        case 'between': {
          if (!Array.isArray(when.value) || when.value.length !== 2) {
            invalidJump('between 的配置值必须是 [min, max]');
          }
          return value >= when.value[0] && value <= when.value[1];
        }
        default:
          invalidJump('不支持的数字跳转运算符', { operator });
      }
    }

    default:
      invalidJump('未知题型无法计算跳转');
  }
}

export function buildPath(survey, answers, mode = 'submit') {
  const questions = [...(survey.questions || [])].sort((a, b) => a.order - b.order);
  if (questions.length === 0) {
    return { path: [], answers: [] };
  }

  const answerMap = new Map();
  for (const answer of answers || []) {
    answerMap.set(idOf(answer.questionId), answer.value);
  }

  const questionMap = new Map(questions.map((question) => [idOf(question._id), question]));
  const nextByOrder = new Map();
  for (let index = 0; index < questions.length; index += 1) {
    nextByOrder.set(idOf(questions[index]._id), questions[index + 1] || null);
  }

  const path = [];
  const visited = new Set();
  let current = questions[0];
  let steps = 0;
  const maxSteps = questions.length * 2 + 10;

  while (current) {
    steps += 1;
    if (steps > maxSteps) {
      throw new AppError(422, 'JUMP_INVALID', '跳转步数过多，可能存在循环');
    }

    const questionId = idOf(current._id);
    if (visited.has(questionId)) {
      throw new AppError(422, 'JUMP_INVALID', '跳转出现循环', { questionId });
    }
    visited.add(questionId);
    path.push(questionId);

    const value = answerMap.get(questionId);
    if (!hasAnswer(value)) {
      if (mode === 'submit' && current.required) {
        throw new AppError(422, 'MISSING_REQUIRED_ANSWER', '必答题未作答', { questionId });
      }
      current = nextByOrder.get(questionId) || null;
      continue;
    }

    let answerIsValid = true;
    try {
      validateAnswer(current, value);
    } catch (error) {
      if (mode === 'submit') throw error;
      answerIsValid = false;
    }

    let target = null;
    if (answerIsValid) {
      const rules = [...(current.jumpRules || [])].sort((a, b) => a.priority - b.priority);
      for (const rule of rules) {
        if (evaluateWhen(current, rule.when, value)) {
          target = rule.target;
          break;
        }
      }
    }

    if (!target) {
      current = nextByOrder.get(questionId) || null;
    } else if (target.type === 'end') {
      current = null;
    } else if (target.type === 'question') {
      current = questionMap.get(idOf(target.questionId)) || null;
      if (!current) {
        throw new AppError(422, 'JUMP_INVALID', '跳转目标不存在', {
          questionId,
          targetQuestionId: idOf(target.questionId)
        });
      }
    } else {
      throw new AppError(422, 'JUMP_INVALID', '未知跳转目标类型');
    }
  }

  const answered = [];
  for (const questionId of path) {
    const value = answerMap.get(questionId);
    if (hasAnswer(value)) {
      answered.push({ questionId, value });
    }
  }

  return { path, answers: answered };
}

function assertInteger(value, name, { min = 0 } = {}) {
  if (value == null) return;
  if (!Number.isInteger(value) || value < min) {
    throw new AppError(400, 'VALIDATION_ERROR', `${name} 必须是不小于 ${min} 的整数`);
  }
}

export function validateQuestionStructure(question) {
  if (!question || typeof question !== 'object') {
    throw new AppError(400, 'VALIDATION_ERROR', '题目必须是对象');
  }
  if (!QUESTION_TYPES.includes(question.type)) {
    throw new AppError(400, 'VALIDATION_ERROR', '未知题型');
  }
  if (!String(question.title || '').trim()) {
    throw new AppError(400, 'VALIDATION_ERROR', '题目不能为空');
  }
  if (!Number.isInteger(question.order) || question.order < 1) {
    throw new AppError(400, 'VALIDATION_ERROR', '题目 order 必须是正整数');
  }
  if (typeof question.required !== 'boolean') {
    throw new AppError(400, 'VALIDATION_ERROR', 'required 必须是布尔值');
  }

  const options = question.options || [];
  if (!Array.isArray(options)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'options 必须是数组');
  }

  if (question.type === 'single' || question.type === 'multiple') {
    if (options.length < 2) {
      throw new AppError(400, 'VALIDATION_ERROR', '选择题至少需要 2 个选项');
    }
    const ids = new Set();
    for (const option of options) {
      if (!option || !option._id || !String(option.label || '').trim()) {
        throw new AppError(400, 'VALIDATION_ERROR', '每个选项都必须有 id 和文案');
      }
      const optionId = idOf(option._id);
      if (ids.has(optionId)) {
        throw new AppError(400, 'VALIDATION_ERROR', '选项 id 不能重复');
      }
      ids.add(optionId);
    }
  } else if (options.length > 0) {
    throw new AppError(400, 'VALIDATION_ERROR', '文本题和数字题不能有选项');
  }

  const validation = question.validation || {};
  if (question.type === 'multiple') {
    assertInteger(validation.minSelections, 'minSelections');
    assertInteger(validation.maxSelections, 'maxSelections');
    if (
      validation.minSelections != null &&
      validation.maxSelections != null &&
      validation.minSelections > validation.maxSelections
    ) {
      throw new AppError(400, 'VALIDATION_ERROR', 'minSelections 不能大于 maxSelections');
    }
    if (validation.minSelections != null && validation.minSelections > options.length) {
      throw new AppError(400, 'VALIDATION_ERROR', 'minSelections 不能超过选项总数');
    }
    if (validation.maxSelections != null && validation.maxSelections > options.length) {
      throw new AppError(400, 'VALIDATION_ERROR', 'maxSelections 不能超过选项总数');
    }
  }

  if (question.type === 'text') {
    assertInteger(validation.minLength, 'minLength');
    assertInteger(validation.maxLength, 'maxLength');
    if (
      validation.minLength != null &&
      validation.maxLength != null &&
      validation.minLength > validation.maxLength
    ) {
      throw new AppError(400, 'VALIDATION_ERROR', 'minLength 不能大于 maxLength');
    }
  }

  if (question.type === 'number') {
    if (validation.min != null && (typeof validation.min !== 'number' || !Number.isFinite(validation.min))) {
      throw new AppError(400, 'VALIDATION_ERROR', '数字题 min 必须是数字');
    }
    if (validation.max != null && (typeof validation.max !== 'number' || !Number.isFinite(validation.max))) {
      throw new AppError(400, 'VALIDATION_ERROR', '数字题 max 必须是数字');
    }
    if (validation.min != null && validation.max != null && validation.min > validation.max) {
      throw new AppError(400, 'VALIDATION_ERROR', '数字题 min 不能大于 max');
    }
    if (validation.integer != null && typeof validation.integer !== 'boolean') {
      throw new AppError(400, 'VALIDATION_ERROR', '数字题 integer 必须是布尔值');
    }
  }

  if (question.jumpRules != null && !Array.isArray(question.jumpRules)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'jumpRules 必须是数组');
  }

  return true;
}

function validateJumpRule(question, rule, questionById, orderById) {
  if (!rule || typeof rule !== 'object') {
    throw new AppError(422, 'JUMP_INVALID', '跳转规则必须是对象');
  }
  if (!Number.isInteger(rule.priority) || rule.priority < 1) {
    throw new AppError(422, 'JUMP_INVALID', '跳转规则 priority 必须是正整数');
  }
  if (!rule.when || typeof rule.when !== 'object') {
    throw new AppError(422, 'JUMP_INVALID', '跳转规则缺少 when');
  }
  if (!rule.target || !['question', 'end'].includes(rule.target.type)) {
    throw new AppError(422, 'JUMP_INVALID', '跳转目标类型必须是 question 或 end');
  }

  const options = question.options || [];
  const allowedOptionIds = new Set(options.map((option) => idOf(option._id)));
  const operator = rule.when.operator;
  const value = rule.when.value;

  if (question.type === 'single') {
    if (operator !== 'eq' || !allowedOptionIds.has(idOf(value))) {
      throw new AppError(422, 'JUMP_INVALID', '单选题跳转必须使用 eq 并引用本题选项');
    }
  } else if (question.type === 'multiple') {
    if (operator !== 'setEq' || !Array.isArray(value) || value.length === 0) {
      throw new AppError(422, 'JUMP_INVALID', '多选题跳转必须使用非空 setEq 数组');
    }
    const ids = value.map(idOf);
    if (new Set(ids).size !== ids.length) {
      throw new AppError(422, 'JUMP_INVALID', 'setEq 不能包含重复选项');
    }
    for (const optionId of ids) {
      if (!allowedOptionIds.has(optionId)) {
        throw new AppError(422, 'JUMP_INVALID', 'setEq 引用了不属于本题的选项');
      }
    }
    const validation = question.validation || {};
    if (validation.minSelections != null && ids.length < validation.minSelections) {
      throw new AppError(422, 'JUMP_INVALID', 'setEq 集合小于 minSelections，规则永远不会命中');
    }
    if (validation.maxSelections != null && ids.length > validation.maxSelections) {
      throw new AppError(422, 'JUMP_INVALID', 'setEq 集合大于 maxSelections，规则永远不会命中');
    }
  } else if (question.type === 'number') {
    if (!['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between'].includes(operator)) {
      throw new AppError(422, 'JUMP_INVALID', '不支持的数字跳转运算符');
    }
    if (operator === 'between') {
      if (!Array.isArray(value) || value.length !== 2 || value.some((item) => typeof item !== 'number')) {
        throw new AppError(422, 'JUMP_INVALID', 'between 的配置值必须是两个数字');
      }
      if (value[0] > value[1]) {
        throw new AppError(422, 'JUMP_INVALID', 'between 的下界不能大于上界');
      }
    } else if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new AppError(422, 'JUMP_INVALID', '数字跳转的配置值必须是数字');
    }
  } else {
    throw new AppError(422, 'JUMP_INVALID', '文本题暂不支持跳转');
  }

  if (rule.target.type === 'question') {
    const targetId = idOf(rule.target.questionId);
    if (!questionById.has(targetId)) {
      throw new AppError(422, 'JUMP_INVALID', '跳转目标题目不存在', { targetQuestionId: targetId });
    }
    if (orderById.get(targetId) <= question.order) {
      throw new AppError(422, 'JUMP_INVALID', '第一阶段只允许跳到后面的题目', { targetQuestionId: targetId });
    }
  }
}

export function validateSurveyForPublish(survey) {
  const questions = [...(survey.questions || [])].sort((a, b) => a.order - b.order);
  if (questions.length === 0) {
    throw new AppError(422, 'PUBLISH_INVALID', '问卷至少需要 1 道题目');
  }

  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index];
    if (question.order !== index + 1) {
      throw new AppError(422, 'PUBLISH_INVALID', '题目 order 必须从 1 开始连续排列');
    }
    validateQuestionStructure(question);
  }

  const questionById = new Map(questions.map((question) => [idOf(question._id), question]));
  const orderById = new Map(questions.map((question) => [idOf(question._id), question.order]));

  for (const question of questions) {
    const rules = question.jumpRules || [];
    const priorities = new Set();
    const conditions = new Set();
    for (const rule of rules) {
      validateJumpRule(question, rule, questionById, orderById);
      if (priorities.has(rule.priority)) {
        throw new AppError(422, 'JUMP_INVALID', '同一题目的跳转 priority 不能重复');
      }
      priorities.add(rule.priority);
      const conditionKey = JSON.stringify({
        operator: rule.when.operator,
        value: Array.isArray(rule.when.value)
          ? rule.when.value.map(idOf).sort()
          : idOf(rule.when.value)
      });
      if (conditions.has(conditionKey)) {
        throw new AppError(422, 'JUMP_INVALID', '同一题目不能配置重复的跳转条件');
      }
      conditions.add(conditionKey);
    }
  }

  return true;
}

export function canonicalizeAnswers(answers) {
  return (answers || [])
    .map((answer) => ({
      questionId: idOf(answer.questionId),
      value: Array.isArray(answer.value)
        ? [...new Set(answer.value.map(idOf))].sort()
        : answer.value
    }))
    .sort((a, b) => a.questionId.localeCompare(b.questionId));
}

export function hashAnswers(answers) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalizeAnswers(answers)))
    .digest('hex');
}
