import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { createHmac } from 'node:crypto';
import { config } from '../config.js';
import { getCollections } from '../db.js';
import { authRequired } from '../auth.js';
import { AppError, asyncHandler } from '../errors.js';
import { parse, responseSchema, toDate } from '../validate.js';
import { buildPath, hashAnswers, idOf } from '../logic.js';
import { publicSurvey, toPlain } from '../serialize.js';

const router = Router();
router.use(authRequired);

function ensureOpen(survey) {
  if (survey.status !== 'published') {
    throw new AppError(410, 'SURVEY_NOT_OPEN', '问卷未发布或已关闭');
  }
  if (survey.deadline && new Date(survey.deadline).getTime() < Date.now()) {
    throw new AppError(410, 'SURVEY_NOT_OPEN', '问卷已截止');
  }
}

function dedupeKeyFor(survey, userId) {
  const surveyId = idOf(survey._id);
  if (!survey.allowAnonymous) {
    return `${surveyId}:${userId}`;
  }
  return createHmac('sha256', config.dedupeSecret)
    .update(`${surveyId}:${userId}`)
    .digest('hex');
}

function storedAnswer(question, value) {
  if (question.type === 'single') {
    return { questionId: question._id, type: 'single', value: new ObjectId(value) };
  }
  if (question.type === 'multiple') {
    return {
      questionId: question._id,
      type: 'multiple',
      value: value.map((optionId) => new ObjectId(optionId))
    };
  }
  if (question.type === 'number') {
    return { questionId: question._id, type: 'number', value: Number(value) };
  }
  return { questionId: question._id, type: 'text', value };
}

router.get(
  '/surveys/:slug',
  asyncHandler(async (req, res) => {
    const { surveys } = getCollections();
    const survey = await surveys.findOne({ slug: req.params.slug });
    if (!survey) {
      throw new AppError(404, 'NOT_FOUND', '问卷不存在');
    }
    ensureOpen(survey);

    res.json({
      ...publicSurvey(survey),
      serverTime: new Date().toISOString()
    });
  })
);

router.get(
  '/surveys/:slug/my-responses',
  asyncHandler(async (req, res) => {
    const { surveys, responses } = getCollections();
    const survey = await surveys.findOne({ slug: req.params.slug });
    if (!survey) {
      throw new AppError(404, 'NOT_FOUND', '问卷不存在');
    }

    const documents = await responses
      .find({
        surveyId: survey._id,
        respondentId: new ObjectId(req.user.id)
      })
      .sort({ submittedAt: 1 })
      .toArray();

    res.json({
      survey: publicSurvey(survey),
      responses: documents.map((document) => {
        const view = toPlain(document);
        delete view.dedupeKey;
        delete view.respondentId;
        return view;
      })
    });
  })
);

router.post(
  '/surveys/:slug/responses',
  asyncHandler(async (req, res) => {
    const input = parse(responseSchema, req.body);
    const { surveys, responses } = getCollections();
    const survey = await surveys.findOne({ slug: req.params.slug });
    if (!survey) {
      throw new AppError(404, 'NOT_FOUND', '问卷不存在');
    }
    ensureOpen(survey);

    const { answers: pathAnswers } = buildPath(survey, input.answers, 'submit');
    if (pathAnswers.length === 0) {
      throw new AppError(422, 'EMPTY_RESPONSE', '请至少回答一道题目');
    }

    const existing = await responses.findOne({
      surveyId: survey._id,
      submissionId: input.submissionId
    });
    if (existing) {
      if (hashAnswers(existing.answers) === hashAnswers(pathAnswers)) {
        return res.status(200).json({
          responseId: idOf(existing._id),
          submittedAt: existing.submittedAt
        });
      }
      throw new AppError(409, 'SUBMISSION_CONFLICT', '同一个 submissionId 对应了不同答案');
    }

    let dedupeKey;
    if (!survey.allowMultipleResponses) {
      dedupeKey = dedupeKeyFor(survey, req.user.id);
      const duplicate = await responses.findOne({ dedupeKey });
      if (duplicate) {
        throw new AppError(409, 'DUPLICATE_RESPONSE', '你已经提交过这份问卷');
      }
    }

    const questionById = new Map(
      (survey.questions || []).map((question) => [idOf(question._id), question])
    );
    const storedAnswers = pathAnswers.map((answer) => {
      const question = questionById.get(idOf(answer.questionId));
      return storedAnswer(question, answer.value);
    });

    const submittedAt = new Date();
    const startedAt = toDate(input.startedAt);
    const durationMs =
      startedAt && submittedAt.getTime() >= startedAt.getTime()
        ? submittedAt.getTime() - startedAt.getTime()
        : undefined;

    const document = {
      surveyId: survey._id,
      surveyVersion: survey.version,
      submissionId: input.submissionId,
      respondentId: survey.allowAnonymous ? null : new ObjectId(req.user.id),
      anonymous: Boolean(survey.allowAnonymous),
      ...(dedupeKey ? { dedupeKey } : {}),
      answers: storedAnswers,
      ...(startedAt ? { startedAt } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      submittedAt
    };

    try {
      const result = await responses.insertOne(document);
      return res.status(201).json({
        responseId: result.insertedId.toHexString(),
        submittedAt
      });
    } catch (error) {
      if (error?.code === 11000) {
        if (error.keyPattern?.submissionId) {
          const raced = await responses.findOne({
            surveyId: survey._id,
            submissionId: input.submissionId
          });
          if (raced && hashAnswers(raced.answers) === hashAnswers(pathAnswers)) {
            return res.status(200).json({
              responseId: idOf(raced._id),
              submittedAt: raced.submittedAt
            });
          }
          throw new AppError(409, 'SUBMISSION_CONFLICT', '同一个 submissionId 对应了不同答案');
        }
        if (error.keyPattern?.dedupeKey) {
          throw new AppError(409, 'DUPLICATE_RESPONSE', '你已经提交过这份问卷');
        }
      }
      throw error;
    }
  })
);

export default router;
