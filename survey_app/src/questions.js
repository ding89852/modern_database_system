import { ObjectId } from 'mongodb';

function toObjectIdIfPossible(value) {
  if (typeof value !== 'string') return value;
  if (!/^[a-fA-F0-9]{24}$/.test(value)) return value;
  return new ObjectId(value);
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  return Number(value);
}

export function normalizeValidation(type, validation = {}) {
  if (type === 'multiple') {
    return {
      minSelections: numberOrNull(validation.minSelections),
      maxSelections: numberOrNull(validation.maxSelections)
    };
  }
  if (type === 'text') {
    return {
      minLength: numberOrNull(validation.minLength),
      maxLength: numberOrNull(validation.maxLength)
    };
  }
  if (type === 'number') {
    return {
      min: numberOrNull(validation.min),
      max: numberOrNull(validation.max),
      integer: Boolean(validation.integer)
    };
  }
  return {};
}

function normalizeWhen(type, when = {}) {
  const operator = when.operator;
  if (type === 'single') {
    return { operator, value: toObjectIdIfPossible(when.value) };
  }
  if (type === 'multiple') {
    return {
      operator,
      value: Array.isArray(when.value)
        ? when.value.map(toObjectIdIfPossible)
        : when.value
    };
  }
  if (type === 'number') {
    return {
      operator,
      value: Array.isArray(when.value)
        ? when.value.map((item) => Number(item))
        : Number(when.value)
    };
  }
  return { operator, value: when.value };
}

function normalizeJumpRules(type, rules = []) {
  return rules.map((rule, index) => {
    const targetType = rule.target?.type;
    const target =
      targetType === 'end'
        ? { type: 'end' }
        : {
            type: 'question',
            questionId: toObjectIdIfPossible(rule.target?.questionId)
          };
    return {
      priority: Number(rule.priority ?? index + 1),
      when: normalizeWhen(type, rule.when || {}),
      target
    };
  });
}

export function normalizeQuestionInput(input, { order, existing } = {}) {
  const type = input.type;
  const optionsSource = input.options !== undefined
    ? input.options
    : (existing?.options || []).map((option) => ({
        id: option._id?.toHexString?.() || String(option._id),
        label: option.label
      }));

  const options =
    type === 'single' || type === 'multiple'
      ? optionsSource.map((option, index) => ({
          _id: option.id ? new ObjectId(option.id) : new ObjectId(),
          order: index + 1,
          label: option.label
        }))
      : [];

  return {
    _id: existing?._id || new ObjectId(),
    order: order ?? existing?.order ?? 1,
    type,
    title: input.title,
    required: input.required ?? false,
    options,
    validation: normalizeValidation(type, input.validation || {}),
    jumpRules: normalizeJumpRules(type, input.jumpRules || [])
  };
}

export function reindexQuestions(questions) {
  return questions.map((question, index) => ({
    ...question,
    order: index + 1
  }));
}

export function existingQuestionToInput(question) {
  return {
    type: question.type,
    title: question.title,
    required: question.required,
    options: (question.options || []).map((option) => ({
      id: option._id?.toHexString?.() || String(option._id),
      label: option.label
    })),
    validation: question.validation || {},
    jumpRules: question.jumpRules || []
  };
}
