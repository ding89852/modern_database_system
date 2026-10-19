import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPath,
  hashAnswers,
  validateAnswer,
  validateSurveyForPublish
} from '../src/logic.js';

function surveyFixture() {
  return {
    _id: 'survey1',
    questions: [
      {
        _id: 'q1',
        order: 1,
        type: 'single',
        title: '单选题',
        required: true,
        options: [
          { _id: 'a', label: 'A' },
          { _id: 'b', label: 'B' }
        ],
        validation: {},
        jumpRules: [
          {
            priority: 1,
            when: { operator: 'eq', value: 'b' },
            target: { type: 'question', questionId: 'q3' }
          }
        ]
      },
      {
        _id: 'q2',
        order: 2,
        type: 'multiple',
        title: '多选题',
        required: true,
        options: [
          { _id: 'x', label: 'X' },
          { _id: 'y', label: 'Y' },
          { _id: 'z', label: 'Z' }
        ],
        validation: { minSelections: 2, maxSelections: 3 },
        jumpRules: [
          {
            priority: 1,
            when: { operator: 'setEq', value: ['x', 'y'] },
            target: { type: 'question', questionId: 'q4' }
          }
        ]
      },
      {
        _id: 'q3',
        order: 3,
        type: 'text',
        title: '文本题',
        required: false,
        options: [],
        validation: { minLength: 0, maxLength: 10 },
        jumpRules: []
      },
      {
        _id: 'q4',
        order: 4,
        type: 'number',
        title: '数字题',
        required: true,
        options: [],
        validation: { min: 0, max: 120, integer: true },
        jumpRules: []
      }
    ]
  };
}

test('多选 setEq 精确匹配，顺序无关', () => {
  const survey = surveyFixture();
  const result = buildPath(
    survey,
    [
      { questionId: 'q1', value: 'a' },
      { questionId: 'q2', value: ['y', 'x'] },
      { questionId: 'q4', value: 20 }
    ],
    'submit'
  );
  assert.deepEqual(result.path, ['q1', 'q2', 'q4']);
});

test('多选多一个或少一个都不跳转', () => {
  const survey = surveyFixture();
  const extra = buildPath(
    survey,
    [
      { questionId: 'q1', value: 'a' },
      { questionId: 'q2', value: ['x', 'y', 'z'] },
      { questionId: 'q3', value: 'hello' },
      { questionId: 'q4', value: 20 }
    ],
    'submit'
  );
  assert.deepEqual(extra.path, ['q1', 'q2', 'q3', 'q4']);
});

test('单选 eq 跳转跳过中间题', () => {
  const survey = surveyFixture();
  const result = buildPath(
    survey,
    [
      { questionId: 'q1', value: 'b' },
      { questionId: 'q4', value: 20 }
    ],
    'submit'
  );
  assert.deepEqual(result.path, ['q1', 'q3', 'q4']);
});

test('跳转到 end 立即结束', () => {
  const survey = surveyFixture();
  survey.questions[1].jumpRules[0].target = { type: 'end' };
  const result = buildPath(
    survey,
    [
      { questionId: 'q1', value: 'a' },
      { questionId: 'q2', value: ['x', 'y'] }
    ],
    'submit'
  );
  assert.deepEqual(result.path, ['q1', 'q2']);
});

test('多条规则按 priority 取第一条', () => {
  const survey = surveyFixture();
  survey.questions[0].jumpRules = [
    {
      priority: 1,
      when: { operator: 'eq', value: 'b' },
      target: { type: 'question', questionId: 'q3' }
    },
    {
      priority: 2,
      when: { operator: 'eq', value: 'b' },
      target: { type: 'question', questionId: 'q4' }
    }
  ];
  const result = buildPath(
    survey,
    [
      { questionId: 'q1', value: 'b' },
      { questionId: 'q4', value: 20 }
    ],
    'submit'
  );
  assert.deepEqual(result.path, ['q1', 'q3', 'q4']);
});

test('必答题缺失在 submit 模式报错，preview 模式继续', () => {
  const survey = surveyFixture();
  assert.throws(
    () => buildPath(survey, [], 'submit'),
    (error) => error.code === 'MISSING_REQUIRED_ANSWER'
  );
  const preview = buildPath(survey, [], 'preview');
  assert.deepEqual(preview.path, ['q1', 'q2', 'q3', 'q4']);
});

test('多选数量校验', () => {
  const survey = surveyFixture();
  assert.throws(
    () =>
      buildPath(
        survey,
        [
          { questionId: 'q1', value: 'a' },
          { questionId: 'q2', value: ['x'] }
        ],
        'submit'
      ),
    (error) => error.code === 'ANSWER_INVALID'
  );
});

test('文本长度按 Unicode code point 计算', () => {
  const question = {
    _id: 'q',
    type: 'text',
    title: 'emoji',
    required: true,
    options: [],
    validation: { minLength: 1, maxLength: 1 }
  };
  assert.equal(validateAnswer(question, '😀'), true);
});

test('数字题范围、整数校验', () => {
  const question = {
    _id: 'n1',
    type: 'number',
    title: '年龄',
    required: true,
    options: [],
    validation: { min: 0, max: 120, integer: true }
  };

  assert.equal(validateAnswer(question, 20), true);
  assert.throws(
    () => validateAnswer(question, 200),
    (error) => error.code === 'ANSWER_INVALID'
  );
  assert.throws(
    () => validateAnswer(question, 20.5),
    (error) => error.code === 'ANSWER_INVALID'
  );
});

test('数字题小数模式允许范围内小数，拒绝越界', () => {
  const question = {
    _id: 'n2',
    type: 'number',
    title: '温度',
    required: true,
    options: [],
    validation: { min: 0, max: 10, integer: false }
  };

  assert.equal(validateAnswer(question, 5.5), true);
  assert.throws(
    () => validateAnswer(question, 10.1),
    (error) => error.code === 'ANSWER_INVALID'
  );
});

test('单选题提交非法选项被拒绝', () => {
  const question = {
    _id: 's1',
    type: 'single',
    title: '单选',
    required: true,
    options: [
      { _id: 'a', label: 'A' },
      { _id: 'b', label: 'B' }
    ],
    validation: {}
  };

  assert.throws(
    () => validateAnswer(question, 'not-an-option'),
    (error) => error.code === 'ANSWER_INVALID'
  );
});

test('文本题超过最大长度被拒绝', () => {
  const question = {
    _id: 't1',
    type: 'text',
    title: '文本',
    required: true,
    options: [],
    validation: { minLength: 1, maxLength: 3 }
  };

  assert.throws(
    () => validateAnswer(question, '四个字符'),
    (error) => error.code === 'ANSWER_INVALID'
  );
});

test('发布校验拒绝向后跳转', () => {
  const survey = surveyFixture();
  survey.questions[1].jumpRules[0].target.questionId = 'q1';
  assert.throws(
    () => validateSurveyForPublish(survey),
    (error) => error.code === 'JUMP_INVALID'
  );
});

test('发布校验拒绝永远无法命中的 setEq 集合', () => {
  const survey = surveyFixture();
  survey.questions[1].jumpRules[0].when.value = ['x'];
  assert.throws(
    () => validateSurveyForPublish(survey),
    (error) => error.code === 'JUMP_INVALID'
  );
});

test('答案哈希与多选顺序无关', () => {
  const first = hashAnswers([
    { questionId: 'q2', value: ['x', 'y'] },
    { questionId: 'q1', value: 'a' }
  ]);
  const second = hashAnswers([
    { questionId: 'q1', value: 'a' },
    { questionId: 'q2', value: ['y', 'x'] }
  ]);
  assert.equal(first, second);
});
