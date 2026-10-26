import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

let app;
let connectDb;
let ensureSchema;
let closeDb;
let getDb;

before(async () => {
  process.env.MONGODB_DB = 'survey_app_test';
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.DEDUPE_SECRET = 'test-dedupe-secret';

  ({ connectDb, ensureSchema, closeDb, getDb } = await import('../src/db.js'));
  const { createApp } = await import('../src/app.js');

  await connectDb({ dbName: 'survey_app_test' });
  await getDb().dropDatabase();
  await ensureSchema();
  app = createApp();
});

after(async () => {
  await getDb().dropDatabase();
  await closeDb();
});

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

async function register(username) {
  const response = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'password123' })
    .expect(201);
  return response.body;
}

test('完整 API 流程：发布、填写、幂等、统计、匿名', async () => {
  const alice = await register('alice');
  const bob = await register('bob');
  const carol = await register('carol');

  const created = await request(app)
    .post('/api/surveys')
    .set(auth(alice.token))
    .send({
      title: '课程反馈',
      description: '测试问卷',
      allowAnonymous: false,
      allowMultipleResponses: false
    })
    .expect(201);
  const surveyId = created.body._id;
  assert.ok(surveyId);

  const q1 = await request(app)
    .post(`/api/surveys/${surveyId}/questions`)
    .set(auth(alice.token))
    .send({
      type: 'single',
      title: '你的性别',
      required: true,
      options: [{ label: '男' }, { label: '女' }]
    })
    .expect(201);

  const q2 = await request(app)
    .post(`/api/surveys/${surveyId}/questions`)
    .set(auth(alice.token))
    .send({
      type: 'multiple',
      title: '你喜欢的水果',
      required: true,
      options: [{ label: '苹果' }, { label: '香蕉' }, { label: '西瓜' }],
      validation: { minSelections: 2, maxSelections: 3 }
    })
    .expect(201);

  const q3 = await request(app)
    .post(`/api/surveys/${surveyId}/questions`)
    .set(auth(alice.token))
    .send({
      type: 'text',
      title: '其他建议',
      required: false,
      validation: { minLength: 0, maxLength: 50 }
    })
    .expect(201);

  const q4 = await request(app)
    .post(`/api/surveys/${surveyId}/questions`)
    .set(auth(alice.token))
    .send({
      type: 'number',
      title: '年龄',
      required: true,
      validation: { min: 0, max: 120, integer: true }
    })
    .expect(201);

  const optionA = q1.body.options[0]._id;
  const optionX = q2.body.options[0]._id;
  const optionY = q2.body.options[1]._id;
  const optionZ = q2.body.options[2]._id;

  await request(app)
    .patch(`/api/surveys/${surveyId}/questions/${q2.body._id}`)
    .set(auth(alice.token))
    .send({
      jumpRules: [
        {
          priority: 1,
          when: { operator: 'setEq', value: [optionX, optionY] },
          target: { type: 'question', questionId: q4.body._id }
        }
      ]
    })
    .expect(200);

  const published = await request(app)
    .post(`/api/surveys/${surveyId}/publish`)
    .set(auth(alice.token))
    .expect(200);
  assert.equal(published.body.status, 'published');
  assert.ok(published.body.slug);

  await request(app).get(`/api/fill/surveys/${published.body.slug}`).expect(401);

  const fill = await request(app)
    .get(`/api/fill/surveys/${published.body.slug}`)
    .set(auth(bob.token))
    .expect(200);
  assert.equal(fill.body.questions.length, 4);
  assert.equal(fill.body.ownerId, undefined);

  const answers = [
    { questionId: q1.body._id, value: optionA },
    { questionId: q2.body._id, value: [optionY, optionX] },
    { questionId: q4.body._id, value: 20 }
  ];
  const submissionId = '11111111-1111-4111-8111-111111111111';

  const submitted = await request(app)
    .post(`/api/fill/surveys/${published.body.slug}/responses`)
    .set(auth(bob.token))
    .send({ submissionId, answers })
    .expect(201);
  const responseId = submitted.body.responseId;
  assert.ok(responseId);

  const retried = await request(app)
    .post(`/api/fill/surveys/${published.body.slug}/responses`)
    .set(auth(bob.token))
    .send({ submissionId, answers: [...answers].reverse() })
    .expect(200);
  assert.equal(retried.body.responseId, responseId);

  const conflict = await request(app)
    .post(`/api/fill/surveys/${published.body.slug}/responses`)
    .set(auth(bob.token))
    .send({
      submissionId,
      answers: [answers[0], { ...answers[1], value: [optionX, optionZ] }, answers[2]]
    })
    .expect(409);
  assert.equal(conflict.body.error.code, 'SUBMISSION_CONFLICT');

  const duplicate = await request(app)
    .post(`/api/fill/surveys/${published.body.slug}/responses`)
    .set(auth(bob.token))
    .send({
      submissionId: '22222222-2222-4222-8222-222222222222',
      answers
    })
    .expect(409);
  assert.equal(duplicate.body.error.code, 'DUPLICATE_RESPONSE');

  const empty = await request(app)
    .post(`/api/fill/surveys/${published.body.slug}/responses`)
    .set(auth(carol.token))
    .send({ submissionId: '33333333-3333-4333-8333-333333333333', answers: [] });
  assert.ok([422, 400].includes(empty.status));

  await request(app)
    .post(`/api/fill/surveys/${published.body.slug}/responses`)
    .set(auth(carol.token))
    .send({
      submissionId: '33333333-3333-4333-8333-333333333333',
      answers
    })
    .expect(201);

  const stats = await request(app)
    .get(`/api/surveys/${surveyId}/stats`)
    .set(auth(alice.token))
    .expect(200);
  assert.equal(stats.body.totalResponses, 2);
  const q1Stats = stats.body.questions.find((item) => item.questionId === q1.body._id);
  const q2Stats = stats.body.questions.find((item) => item.questionId === q2.body._id);
  const q3Stats = stats.body.questions.find((item) => item.questionId === q3.body._id);
  const q4Stats = stats.body.questions.find((item) => item.questionId === q4.body._id);
  assert.equal(q1Stats.options[0].count, 2);
  assert.equal(q2Stats.answeredCount, 2);
  assert.equal(q2Stats.options[0].count, 2);
  assert.equal(q3Stats.answeredCount, 0);
  assert.equal(q4Stats.average, 20);
  assert.equal(q4Stats.min, 20);
  assert.equal(q4Stats.max, 20);

  await request(app)
    .get(`/api/surveys/${surveyId}/stats`)
    .set(auth(bob.token))
    .expect(404);

  const responses = await request(app)
    .get(`/api/surveys/${surveyId}/responses`)
    .set(auth(alice.token))
    .expect(200);
  assert.equal(responses.body.total, 2);
  assert.equal(responses.body.items[0].respondent.username, 'carol');
  assert.equal(responses.body.items[0].dedupeKey, undefined);

  const locked = await request(app)
    .patch(`/api/surveys/${surveyId}/questions/${q1.body._id}`)
    .set(auth(alice.token))
    .send({ title: '不能改' })
    .expect(409);
  assert.equal(locked.body.error.code, 'SURVEY_LOCKED');

  await request(app)
    .post(`/api/surveys/${surveyId}/close`)
    .set(auth(alice.token))
    .expect(200);

  await request(app)
    .get(`/api/fill/surveys/${published.body.slug}`)
    .set(auth(bob.token))
    .expect(410);

  const anonymousSurvey = await request(app)
    .post('/api/surveys')
    .set(auth(alice.token))
    .send({
      title: '匿名问卷',
      allowAnonymous: true,
      allowMultipleResponses: false
    })
    .expect(201);

  const anonymousQuestion = await request(app)
    .post(`/api/surveys/${anonymousSurvey.body._id}/questions`)
    .set(auth(alice.token))
    .send({
      type: 'single',
      title: '单选',
      required: true,
      options: [{ label: 'A' }, { label: 'B' }]
    })
    .expect(201);

  const anonymousPublished = await request(app)
    .post(`/api/surveys/${anonymousSurvey.body._id}/publish`)
    .set(auth(alice.token))
    .expect(200);

  await request(app)
    .post(`/api/fill/surveys/${anonymousPublished.body.slug}/responses`)
    .set(auth(bob.token))
    .send({
      submissionId: '44444444-4444-4444-8444-444444444444',
      answers: [
        {
          questionId: anonymousQuestion.body._id,
          value: anonymousQuestion.body.options[0]._id
        }
      ]
    })
    .expect(201);

  const anonymousResponses = await request(app)
    .get(`/api/surveys/${anonymousSurvey.body._id}/responses`)
    .set(auth(alice.token))
    .expect(200);
  assert.equal(anonymousResponses.body.items[0].respondentId, undefined);
  assert.equal(anonymousResponses.body.items[0].dedupeKey, undefined);
  assert.equal(anonymousResponses.body.items[0].respondent, undefined);

  const bobFilled = await request(app)
    .get('/api/surveys/filled')
    .set(auth(bob.token))
    .expect(200);
  assert.ok(bobFilled.body.items.some((item) => item.id === surveyId));
  assert.ok(
    !bobFilled.body.items.some(
      (item) => item.id === anonymousSurvey.body._id
    )
  );

  const myResponses = await request(app)
    .get(`/api/fill/surveys/${published.body.slug}/my-responses`)
    .set(auth(bob.token))
    .expect(200);
  assert.equal(myResponses.body.responses.length, 1);
  assert.equal(myResponses.body.responses[0].answers.length, 3);
  assert.equal(myResponses.body.responses[0].respondentId, undefined);
  assert.equal(myResponses.body.responses[0].dedupeKey, undefined);

  const anonymousMine = await request(app)
    .get(`/api/fill/surveys/${anonymousPublished.body.slug}/my-responses`)
    .set(auth(bob.token))
    .expect(200);
  assert.equal(anonymousMine.body.responses.length, 0);
});

test('批量保存题目：clientId 映射、选项映射和草稿设置', async () => {
  const dave = await register('dave');
  const created = await request(app)
    .post('/api/surveys')
    .set(auth(dave.token))
    .send({ title: '批量编辑测试' })
    .expect(201);

  const saved = await request(app)
    .put(`/api/surveys/${created.body._id}/questions`)
    .set(auth(dave.token))
    .send({
      questions: [
        {
          clientId: 'q-one',
          type: 'single',
          title: '第一题',
          required: true,
          options: [
            { clientId: 'opt-a', label: 'A' },
            { clientId: 'opt-b', label: 'B' }
          ],
          validation: {},
          jumpRules: [
            {
              priority: 1,
              when: { operator: 'eq', value: 'opt-b' },
              target: { type: 'question', clientId: 'q-two' }
            }
          ]
        },
        {
          clientId: 'q-two',
          type: 'number',
          title: '第二题',
          required: true,
          options: [],
          validation: { min: 0, max: 120, integer: true },
          jumpRules: []
        }
      ]
    })
    .expect(200);

  assert.equal(saved.body.questions.length, 2);
  assert.equal(saved.body.questions[0].order, 1);
  assert.equal(saved.body.questions[1].order, 2);
  assert.match(saved.body.questions[0]._id, /^[a-f0-9]{24}$/);
  assert.equal(
    saved.body.questions[0].jumpRules[0].target.questionId,
    saved.body.questions[1]._id
  );
  assert.equal(
    saved.body.questions[0].jumpRules[0].when.value,
    saved.body.questions[0].options[1]._id
  );

  const patched = await request(app)
    .patch(`/api/surveys/${created.body._id}`)
    .set(auth(dave.token))
    .send({ allowAnonymous: true, allowMultipleResponses: true })
    .expect(200);
  assert.equal(patched.body.allowAnonymous, true);
  assert.equal(patched.body.allowMultipleResponses, true);
});

test('截止时间必须晚于当前时间', async () => {
  const erin = await register('erin');
  const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const rejected = await request(app)
    .post('/api/surveys')
    .set(auth(erin.token))
    .send({ title: '过去截止', deadline: past })
    .expect(400);

  assert.equal(
    rejected.body.error.details[0].message,
    '截止时间必须晚于当前时间'
  );

  const created = await request(app)
    .post('/api/surveys')
    .set(auth(erin.token))
    .send({
      title: '未来截止',
      deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    })
    .expect(201);

  const patchRejected = await request(app)
    .patch(`/api/surveys/${created.body._id}`)
    .set(auth(erin.token))
    .send({ deadline: past })
    .expect(400);

  assert.equal(
    patchRejected.body.error.details[0].message,
    '截止时间必须晚于当前时间'
  );
});

test('并发提交同一问卷只保存一份', async () => {
  const frank = await register('frank');
  const created = await request(app)
    .post('/api/surveys')
    .set(auth(frank.token))
    .send({
      title: '并发提交测试',
      allowMultipleResponses: false
    })
    .expect(201);

  const question = await request(app)
    .post(`/api/surveys/${created.body._id}/questions`)
    .set(auth(frank.token))
    .send({
      type: 'single',
      title: '单选',
      required: true,
      options: [{ label: 'A' }, { label: 'B' }]
    })
    .expect(201);

  const published = await request(app)
    .post(`/api/surveys/${created.body._id}/publish`)
    .set(auth(frank.token))
    .expect(200);

  const payloadAnswer = {
    questionId: question.body._id,
    value: question.body.options[0]._id
  };

  const [first, second] = await Promise.all([
    request(app)
      .post(`/api/fill/surveys/${published.body.slug}/responses`)
      .set(auth(frank.token))
      .send({
        submissionId: 'race-0001',
        answers: [payloadAnswer]
      }),
    request(app)
      .post(`/api/fill/surveys/${published.body.slug}/responses`)
      .set(auth(frank.token))
      .send({
        submissionId: 'race-0002',
        answers: [payloadAnswer]
      })
  ]);

  assert.deepEqual(
    [first.status, second.status].sort(),
    [201, 409]
  );
  const rejected = [first, second].find((response) => response.status === 409);
  assert.equal(rejected.body.error.code, 'DUPLICATE_RESPONSE');

  const responses = await request(app)
    .get(`/api/surveys/${created.body._id}/responses`)
    .set(auth(frank.token))
    .expect(200);
  assert.equal(responses.body.total, 1);
});

test('全空白卷返回 EMPTY_RESPONSE', async () => {
  const grace = await register('grace');
  const created = await request(app)
    .post('/api/surveys')
    .set(auth(grace.token))
    .send({ title: '空白卷测试' })
    .expect(201);

  await request(app)
    .post(`/api/surveys/${created.body._id}/questions`)
    .set(auth(grace.token))
    .send({
      type: 'text',
      title: '选填',
      required: false,
      validation: { minLength: 0, maxLength: 10 }
    })
    .expect(201);

  const published = await request(app)
    .post(`/api/surveys/${created.body._id}/publish`)
    .set(auth(grace.token))
    .expect(200);

  const response = await request(app)
    .post(`/api/fill/surveys/${published.body.slug}/responses`)
    .set(auth(grace.token))
    .send({
      submissionId: 'empty-0001',
      answers: []
    })
    .expect(422);

  assert.equal(response.body.error.code, 'EMPTY_RESPONSE');
});

test('统计：单选百分比、文本答案和文本答案分页', async () => {
  const henry = await register('henry');
  const ivy = await register('ivy');

  const created = await request(app)
    .post('/api/surveys')
    .set(auth(henry.token))
    .send({ title: '统计测试', allowMultipleResponses: false })
    .expect(201);

  const single = await request(app)
    .post(`/api/surveys/${created.body._id}/questions`)
    .set(auth(henry.token))
    .send({
      type: 'single',
      title: '选择',
      required: true,
      options: [{ label: 'A' }, { label: 'B' }]
    })
    .expect(201);

  const text = await request(app)
    .post(`/api/surveys/${created.body._id}/questions`)
    .set(auth(henry.token))
    .send({
      type: 'text',
      title: '建议',
      required: false,
      validation: { minLength: 0, maxLength: 20 }
    })
    .expect(201);

  const published = await request(app)
    .post(`/api/surveys/${created.body._id}/publish`)
    .set(auth(henry.token))
    .expect(200);

  await request(app)
    .post(`/api/fill/surveys/${published.body.slug}/responses`)
    .set(auth(henry.token))
    .send({
      submissionId: 'stats-0001',
      answers: [
        { questionId: single.body._id, value: single.body.options[0]._id },
        { questionId: text.body._id, value: 'hello' }
      ]
    })
    .expect(201);

  await request(app)
    .post(`/api/fill/surveys/${published.body.slug}/responses`)
    .set(auth(ivy.token))
    .send({
      submissionId: 'stats-0002',
      answers: [
        { questionId: single.body._id, value: single.body.options[1]._id },
        { questionId: text.body._id, value: 'world' }
      ]
    })
    .expect(201);

  const stats = await request(app)
    .get(`/api/surveys/${created.body._id}/stats`)
    .set(auth(henry.token))
    .expect(200);

  const singleStats = stats.body.questions.find(
    (item) => item.questionId === single.body._id
  );
  const textStats = stats.body.questions.find(
    (item) => item.questionId === text.body._id
  );

  assert.equal(singleStats.answeredCount, 2);
  assert.equal(singleStats.options[0].percentage, 50);
  assert.equal(singleStats.options[1].percentage, 50);
  assert.equal(textStats.answeredCount, 2);
  assert.deepEqual(new Set(textStats.answers), new Set(['hello', 'world']));

  const textAnswers = await request(app)
    .get(
      `/api/surveys/${created.body._id}/questions/${text.body._id}/answers?page=1&pageSize=10`
    )
    .set(auth(henry.token))
    .expect(200);

  assert.equal(textAnswers.body.total, 2);
  assert.deepEqual(
    new Set(textAnswers.body.items.map((item) => item.value)),
    new Set(['hello', 'world'])
  );
});

test('创建参数和发布前校验', async () => {
  const judy = await register('judy');

  await request(app)
    .post('/api/surveys')
    .set(auth(judy.token))
    .send({ title: '' })
    .expect(400);

  const created = await request(app)
    .post('/api/surveys')
    .set(auth(judy.token))
    .send({ title: '空问卷' })
    .expect(201);

  const published = await request(app)
    .post(`/api/surveys/${created.body._id}/publish`)
    .set(auth(judy.token))
    .expect(422);
  assert.equal(published.body.error.code, 'PUBLISH_INVALID');
});

test('创建权限和题目结构校验', async () => {
  await request(app)
    .post('/api/surveys')
    .send({ title: '未登录问卷' })
    .expect(401);

  const kate = await register('kate');
  const leo = await register('leo');
  const created = await request(app)
    .post('/api/surveys')
    .set(auth(kate.token))
    .send({ title: '权限测试' })
    .expect(201);

  await request(app)
    .get(`/api/surveys/${created.body._id}`)
    .set(auth(leo.token))
    .expect(404);

  const leoList = await request(app)
    .get('/api/surveys')
    .set(auth(leo.token))
    .expect(200);
  assert.ok(
    !leoList.body.items.some((item) => item.id === created.body._id)
  );

  await request(app)
    .post(`/api/surveys/${created.body._id}/questions`)
    .set(auth(kate.token))
    .send({
      type: 'single',
      title: '只有一个选项',
      options: [{ label: 'A' }]
    })
    .expect(400);

  await request(app)
    .post(`/api/surveys/${created.body._id}/questions`)
    .set(auth(kate.token))
    .send({
      type: 'multiple',
      title: '数量矛盾',
      options: [{ label: 'A' }, { label: 'B' }],
      validation: { minSelections: 2, maxSelections: 1 }
    })
    .expect(400);
});

test('数字题支持小数模式和整数模式', async () => {
  const nina = await register('nina');
  const created = await request(app)
    .post('/api/surveys')
    .set(auth(nina.token))
    .send({ title: '数字类型测试', allowMultipleResponses: true })
    .expect(201);

  const decimalQuestion = await request(app)
    .post(`/api/surveys/${created.body._id}/questions`)
    .set(auth(nina.token))
    .send({
      type: 'number',
      title: '小数题',
      required: true,
      validation: { min: 0, max: 10, integer: false }
    })
    .expect(201);

  const integerQuestion = await request(app)
    .post(`/api/surveys/${created.body._id}/questions`)
    .set(auth(nina.token))
    .send({
      type: 'number',
      title: '整数题',
      required: true,
      validation: { min: 0, max: 10, integer: true }
    })
    .expect(201);

  const published = await request(app)
    .post(`/api/surveys/${created.body._id}/publish`)
    .set(auth(nina.token))
    .expect(200);

  await request(app)
    .post(`/api/fill/surveys/${published.body.slug}/responses`)
    .set(auth(nina.token))
    .send({
      submissionId: 'num-0001',
      answers: [
        { questionId: decimalQuestion.body._id, value: 5.5 },
        { questionId: integerQuestion.body._id, value: 5 }
      ]
    })
    .expect(201);

  const outOfRange = await request(app)
    .post(`/api/fill/surveys/${published.body.slug}/responses`)
    .set(auth(nina.token))
    .send({
      submissionId: 'num-0002',
      answers: [
        { questionId: decimalQuestion.body._id, value: 10.1 },
        { questionId: integerQuestion.body._id, value: 5 }
      ]
    })
    .expect(422);
  assert.equal(outOfRange.body.error.code, 'ANSWER_INVALID');

  const decimalInIntegerMode = await request(app)
    .post(`/api/fill/surveys/${published.body.slug}/responses`)
    .set(auth(nina.token))
    .send({
      submissionId: 'num-0003',
      answers: [
        { questionId: decimalQuestion.body._id, value: 5.5 },
        { questionId: integerQuestion.body._id, value: 5.5 }
      ]
    })
    .expect(422);
  assert.equal(decimalInIntegerMode.body.error.code, 'ANSWER_INVALID');
});

test('题库版本、共享、使用关系和跨问卷统计', async () => {
  const owner = await register('bank_owner');
  const user = await register('bank_user');

  const bankV1 = await request(app)
    .post('/api/question-bank')
    .set(auth(owner.token))
    .send({
      type: 'number',
      title: '年龄',
      required: true,
      validation: { min: 0, max: 120, integer: true },
      changeNote: '初始版本'
    })
    .expect(201);

  assert.equal(bankV1.body.version, 1);
  assert.equal(bankV1.body.isLatest, true);
  assert.ok(bankV1.body.familyId);

  const shared = await request(app)
    .post('/api/shared-questions')
    .set(auth(owner.token))
    .send({
      question: {
        type: 'number',
        title: bankV1.body.title,
        required: true,
        options: [],
        validation: bankV1.body.validation
      },
      questionVersionId: bankV1.body._id,
      questionFamilyId: bankV1.body.familyId,
      questionVersion: bankV1.body.version
    })
    .expect(201);
  assert.ok(shared.body.token);
  assert.ok(shared.body.url.includes('/shared-question/'));

  const ownerBankAfterShare = await request(app)
    .get('/api/question-bank')
    .set(auth(owner.token))
    .expect(200);
  assert.equal(
    ownerBankAfterShare.body.items.find((item) => item._id === bankV1.body._id)
      .isShared,
    true
  );

  const imported = await request(app)
    .get(`/api/shared-questions/${shared.body.token}`)
    .set(auth(user.token))
    .expect(200);
  assert.equal(imported.body.title, '年龄');

  const userBank = await request(app)
    .get('/api/question-bank')
    .set(auth(user.token))
    .expect(200);
  assert.ok(!userBank.body.items.some((item) => item._id === bankV1.body._id));

  const sharedFromSurveyEditor = await request(app)
    .post('/api/shared-questions')
    .set(auth(user.token))
    .send({
      question: {
        type: 'text',
        title: '问卷编辑器共享题',
        required: false,
        options: [],
        validation: { minLength: 0, maxLength: 100 }
      }
    })
    .expect(201);
  assert.equal(sharedFromSurveyEditor.body.bankQuestion.title, '问卷编辑器共享题');
  assert.equal(sharedFromSurveyEditor.body.bankQuestion.version, 1);

  const userBankAfterCreateShare = await request(app)
    .get('/api/question-bank')
    .set(auth(user.token))
    .expect(200);
  assert.ok(
    userBankAfterCreateShare.body.items.some(
      (item) => item._id === sharedFromSurveyEditor.body.bankQuestion._id
    )
  );

  await request(app)
    .get(`/api/shared-questions/${shared.body.token}`)
    .expect(401);

  await request(app)
    .get('/api/shared-questions/not-a-valid-share-link')
    .set(auth(user.token))
    .expect(404);

  await request(app)
    .post(`/api/question-bank/${bankV1.body._id}/share`)
    .set(auth(owner.token))
    .send({ shared: true })
    .expect(404);

  async function createSurveyWithBankQuestion(token, submissionId, value) {
    const survey = await request(app)
      .post('/api/surveys')
      .set(auth(token))
      .send({ title: `题库使用 ${submissionId}`, allowMultipleResponses: false })
      .expect(201);

    await request(app)
      .put(`/api/surveys/${survey.body._id}/questions`)
      .set(auth(token))
      .send({
        questions: [
          {
            clientId: 'bank-q',
            type: 'number',
            title: bankV1.body.title,
            required: true,
            options: [],
            validation: bankV1.body.validation,
            jumpRules: [],
            questionVersionId: bankV1.body._id,
            questionFamilyId: bankV1.body.familyId,
            questionVersion: bankV1.body.version
          }
        ]
      })
      .expect(200);

    const published = await request(app)
      .post(`/api/surveys/${survey.body._id}/publish`)
      .set(auth(token))
      .expect(200);

    const question = (
      await request(app)
        .get(`/api/surveys/${survey.body._id}`)
        .set(auth(token))
        .expect(200)
    ).body.questions[0];

    await request(app)
      .post(`/api/fill/surveys/${published.body.slug}/responses`)
      .set(auth(token))
      .send({
        submissionId,
        answers: [{ questionId: question._id, value }]
      })
      .expect(201);

    return { survey, question };
  }

  const ownerUse = await createSurveyWithBankQuestion(owner.token, 'bank-0001', 20);
  await createSurveyWithBankQuestion(user.token, 'bank-0002', 30);

  const usages = await request(app)
    .get(`/api/question-bank/${bankV1.body.familyId}/usages`)
    .set(auth(owner.token))
    .expect(200);
  assert.equal(usages.body.surveyCount, 2);
  assert.deepEqual(
    new Set(usages.body.items.flatMap((item) => item.versions)),
    new Set([1])
  );

  const stats = await request(app)
    .get(`/api/question-bank/${bankV1.body.familyId}/stats`)
    .set(auth(owner.token))
    .expect(200);
  assert.equal(stats.body.surveyCount, 2);
  assert.equal(stats.body.responseCount, 2);
  assert.equal(stats.body.overall.average, 25);
  assert.equal(stats.body.overall.min, 20);
  assert.equal(stats.body.overall.max, 30);

  const bankV2 = await request(app)
    .post(`/api/question-bank/${bankV1.body._id}/versions`)
    .set(auth(owner.token))
    .send({
      title: '年龄（新版）',
      validation: { min: 0, max: 100, integer: true },
      changeNote: '调整上限'
    })
    .expect(201);
  assert.equal(bankV2.body.version, 2);
  assert.equal(bankV2.body.familyId, bankV1.body.familyId);

  const importedAfterBankUpdate = await request(app)
    .get(`/api/shared-questions/${shared.body.token}`)
    .set(auth(user.token))
    .expect(200);
  assert.equal(importedAfterBankUpdate.body.title, '年龄');
  assert.equal(importedAfterBankUpdate.body.questionVersion, 1);

  const surveyUsingV2 = await request(app)
    .post('/api/surveys')
    .set(auth(owner.token))
    .send({ title: '独立使用历史版本 v2' })
    .expect(201);
  await request(app)
    .put(`/api/surveys/${surveyUsingV2.body._id}/questions`)
    .set(auth(owner.token))
    .send({
      questions: [
        {
          clientId: 'v2-question',
          type: bankV2.body.type,
          title: bankV2.body.title,
          required: bankV2.body.required,
          options: [],
          validation: bankV2.body.validation,
          jumpRules: [],
          questionVersionId: bankV2.body._id,
          questionFamilyId: bankV2.body.familyId,
          questionVersion: bankV2.body.version
        }
      ]
    })
    .expect(200);
  const surveyUsingV2Data = await request(app)
    .get(`/api/surveys/${surveyUsingV2.body._id}`)
    .set(auth(owner.token))
    .expect(200);
  assert.equal(surveyUsingV2Data.body.questions[0].title, '年龄（新版）');
  assert.equal(surveyUsingV2Data.body.questions[0].questionVersion, 2);

  const surveyAfterBankUpdate = await request(app)
    .get(`/api/surveys/${ownerUse.survey.body._id}`)
    .set(auth(owner.token))
    .expect(200);
  assert.equal(surveyAfterBankUpdate.body.questions[0].title, '年龄');

  const history = await request(app)
    .get(`/api/question-bank/${bankV1.body.familyId}/history`)
    .set(auth(owner.token))
    .expect(200);
  assert.equal(history.body.items.length, 2);
  assert.equal(history.body.items[1].version, 2);

  await request(app)
    .get(`/api/question-bank/${bankV1.body._id}`)
    .set(auth(user.token))
    .expect(404);

  const derived = await request(app)
    .post(`/api/question-bank/${bankV1.body._id}/derive`)
    .set(auth(owner.token))
    .expect(201);
  assert.notEqual(derived.body.familyId, bankV1.body.familyId);
  assert.equal(derived.body.ownerId, owner.user.id);
  assert.equal(derived.body.derivedFromVersionId, bankV1.body._id);

  const restored = await request(app)
    .post(`/api/question-bank/${bankV1.body._id}/restore`)
    .set(auth(owner.token))
    .expect(201);
  assert.equal(restored.body.version, 3);
  assert.equal(restored.body.previousVersionId, bankV1.body._id);

  const finalHistory = await request(app)
    .get(`/api/question-bank/${bankV1.body.familyId}/history`)
    .set(auth(owner.token))
    .expect(200);
  assert.equal(finalHistory.body.items.length, 3);

  const allBankVersions = await request(app)
    .get('/api/question-bank?versions=all&pageSize=100')
    .set(auth(owner.token))
    .expect(200);
  const ageVersions = allBankVersions.body.items.filter(
    (item) => item.familyId === bankV1.body.familyId
  );
  assert.deepEqual(
    ageVersions.map((item) => item.version).sort((a, b) => a - b),
    [1, 2, 3]
  );
  assert.equal(
    ageVersions.filter((item) => item.isLatest).length,
    1
  );
});
