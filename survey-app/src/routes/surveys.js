import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { getCollections } from '../db.js';
import { authRequired } from '../auth.js';
import { AppError, asyncHandler } from '../errors.js';
import {
  parse,
  createSurveySchema,
  patchSurveySchema,
  questionInputSchema,
  questionPatchSchema,
  reorderSchema,
  bulkQuestionsSchema,
  toDate
} from '../validate.js';
import {
  normalizeQuestionInput,
  normalizeValidation,
  reindexQuestions,
  existingQuestionToInput
} from '../questions.js';
import {
  idOf,
  validateQuestionStructure,
  validateSurveyForPublish
} from '../logic.js';
import { toPlain } from '../serialize.js';

const router = Router();
router.use(authRequired);

function ownerIdOf(req) {
  return new ObjectId(req.user.id);
}

function surveyIdOf(req) {
  try {
    return new ObjectId(req.params.id);
  } catch {
    throw new AppError(400, 'VALIDATION_ERROR', '问卷 id 不合法');
  }
}

function questionIdOf(req) {
  try {
    return new ObjectId(req.params.questionId);
  } catch {
    throw new AppError(400, 'VALIDATION_ERROR', '题目 id 不合法');
  }
}

async function findOwnedSurvey(req) {
  const { surveys } = getCollections();
  const survey = await surveys.findOne({
    _id: surveyIdOf(req),
    ownerId: ownerIdOf(req)
  });
  if (!survey) {
    throw new AppError(404, 'NOT_FOUND', '问卷不存在');
  }
  return survey;
}

function ensureDraft(survey) {
  if (survey.status !== 'draft') {
    throw new AppError(409, 'SURVEY_LOCKED', '问卷已发布，题目结构不可再修改');
  }
}

function randomSlug() {
  return randomBytes(8).toString('base64url').slice(0, 10);
}

function surveySummary(survey, responseCount) {
  return {
    id: idOf(survey._id),
    title: survey.title,
    status: survey.status,
    slug: survey.slug || null,
    questionCount: (survey.questions || []).length,
    responseCount,
    allowAnonymous: survey.allowAnonymous,
    allowMultipleResponses: survey.allowMultipleResponses,
    deadline: survey.deadline,
    createdAt: survey.createdAt,
    updatedAt: survey.updatedAt
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { surveys, responses } = getCollections();
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const status = req.query.status ? String(req.query.status) : null;
    if (status && !['draft', 'published', 'closed'].includes(status)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'status 不合法');
    }

    const filter = { ownerId: ownerIdOf(req) };
    if (status) filter.status = status;

    const [items, total] = await Promise.all([
      surveys
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
      surveys.countDocuments(filter)
    ]);

    const ids = items.map((survey) => survey._id);
    const counts = ids.length
      ? await responses
          .aggregate([
            { $match: { surveyId: { $in: ids } } },
            { $group: { _id: '$surveyId', count: { $sum: 1 } } }
          ])
          .toArray()
      : [];
    const countMap = new Map(counts.map((item) => [idOf(item._id), item.count]));

    res.json({
      items: items.map((survey) => surveySummary(survey, countMap.get(idOf(survey._id)) || 0)),
      page,
      pageSize,
      total
    });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parse(createSurveySchema, req.body);
    const { surveys } = getCollections();
    const now = new Date();
    const document = {
      ownerId: ownerIdOf(req),
      title: input.title,
      description: input.description,
      status: 'draft',
      allowAnonymous: input.allowAnonymous,
      allowMultipleResponses: input.allowMultipleResponses,
      deadline: toDate(input.deadline),
      version: 1,
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
      closedAt: null,
      questions: []
    };

    const result = await surveys.insertOne(document);
    res.status(201).json(toPlain({ ...document, _id: result.insertedId }));
  })
);

router.get(
  '/filled',
  asyncHandler(async (req, res) => {
    const { responses } = getCollections();
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const userId = ownerIdOf(req);

    const [totalResult] = await responses
      .aggregate([
        { $match: { respondentId: userId } },
        { $group: { _id: '$surveyId' } },
        { $count: 'total' }
      ])
      .toArray();

    const items = await responses
      .aggregate([
        { $match: { respondentId: userId } },
        { $sort: { submittedAt: -1 } },
        {
          $group: {
            _id: '$surveyId',
            submissionCount: { $sum: 1 },
            lastSubmittedAt: { $first: '$submittedAt' },
            lastResponseId: { $first: '$_id' }
          }
        },
        {
          $lookup: {
            from: 'surveys',
            localField: '_id',
            foreignField: '_id',
            as: 'survey'
          }
        },
        { $unwind: '$survey' },
        { $match: { 'survey.status': { $in: ['published', 'closed'] } } },
        { $sort: { lastSubmittedAt: -1 } },
        { $skip: (page - 1) * pageSize },
        { $limit: pageSize }
      ])
      .toArray();

    res.json({
      items: items.map((item) => ({
        id: idOf(item._id),
        title: item.survey.title,
        status: item.survey.status,
        slug: item.survey.slug || null,
        submissionCount: item.submissionCount,
        lastSubmittedAt: item.lastSubmittedAt,
        lastResponseId: idOf(item.lastResponseId)
      })),
      page,
      pageSize,
      total: totalResult?.total || 0
    });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const survey = await findOwnedSurvey(req);
    res.json(toPlain(survey));
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const survey = await findOwnedSurvey(req);
    if (survey.status === 'closed') {
      throw new AppError(409, 'SURVEY_LOCKED', '问卷已关闭，不能再修改');
    }

    const input = parse(patchSurveySchema, req.body);
    const update = { updatedAt: new Date() };
    if (input.title !== undefined) update.title = input.title;
    if (input.description !== undefined) update.description = input.description;
    if (input.deadline !== undefined) update.deadline = toDate(input.deadline);
    if (input.allowAnonymous !== undefined || input.allowMultipleResponses !== undefined) {
      if (survey.status !== 'draft') {
        throw new AppError(409, 'SURVEY_LOCKED', '问卷发布后不能修改匿名或重复填写设置');
      }
      if (input.allowAnonymous !== undefined) update.allowAnonymous = input.allowAnonymous;
      if (input.allowMultipleResponses !== undefined) {
        update.allowMultipleResponses = input.allowMultipleResponses;
      }
    }

    const { surveys } = getCollections();
    const updated = await surveys.findOneAndUpdate(
      {
        _id: survey._id,
        ownerId: ownerIdOf(req),
        status: { $in: ['draft', 'published'] }
      },
      { $set: update },
      { returnDocument: 'after' }
    );

    if (!updated) {
      throw new AppError(409, 'SURVEY_LOCKED', '问卷状态已变化，请刷新后重试');
    }
    res.json(toPlain(updated));
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const survey = await findOwnedSurvey(req);
    ensureDraft(survey);
    const { surveys, responses } = getCollections();
    const responseCount = await responses.countDocuments({ surveyId: survey._id });
    if (responseCount > 0) {
      throw new AppError(409, 'SURVEY_LOCKED', '已有答卷的问卷不能删除');
    }
    await surveys.deleteOne({ _id: survey._id, ownerId: ownerIdOf(req) });
    res.status(204).end();
  })
);

router.post(
  '/:id/questions',
  asyncHandler(async (req, res) => {
    const survey = await findOwnedSurvey(req);
    ensureDraft(survey);
    const input = parse(questionInputSchema, req.body);
    const question = normalizeQuestionInput(input, {
      order: (survey.questions || []).length + 1
    });
    validateQuestionStructure(question);

    const { surveys } = getCollections();
    const result = await surveys.updateOne(
      {
        _id: survey._id,
        ownerId: ownerIdOf(req),
        status: 'draft'
      },
      {
        $push: { questions: question },
        $set: { updatedAt: new Date() }
      }
    );

    if (result.modifiedCount !== 1) {
      throw new AppError(409, 'SURVEY_LOCKED', '问卷状态已变化，请刷新后重试');
    }
    res.status(201).json(toPlain(question));
  })
);

router.put(
  '/:id/questions',
  asyncHandler(async (req, res) => {
    const survey = await findOwnedSurvey(req);
    ensureDraft(survey);
    const { questions: inputQuestions } = parse(bulkQuestionsSchema, req.body);

    const questionClientIds = new Set();
    const usedQuestionIds = new Set();
    const questionIdByClientId = new Map();
    const prepared = inputQuestions.map((input, index) => {
      if (questionClientIds.has(input.clientId)) {
        throw new AppError(400, 'VALIDATION_ERROR', '题目 clientId 不能重复');
      }
      questionClientIds.add(input.clientId);

      const questionId = input.id ? new ObjectId(input.id) : new ObjectId();
      if (usedQuestionIds.has(questionId.toHexString())) {
        throw new AppError(400, 'VALIDATION_ERROR', '题目 id 不能重复');
      }
      usedQuestionIds.add(questionId.toHexString());
      questionIdByClientId.set(input.clientId, questionId);

      return { input, questionId, order: index + 1 };
    });

    const saved = prepared.map(({ input, questionId, order }) => {
      const optionClientIds = new Set();
      const usedOptionIds = new Set();
      const optionIdByClientId = new Map();
      const optionInputs = ['single', 'multiple'].includes(input.type)
        ? input.options || []
        : [];

      const options = optionInputs.map((option, index) => {
        if (optionClientIds.has(option.clientId)) {
          throw new AppError(400, 'VALIDATION_ERROR', '选项 clientId 不能重复');
        }
        optionClientIds.add(option.clientId);

        const optionId = option.id ? new ObjectId(option.id) : new ObjectId();
        if (usedOptionIds.has(optionId.toHexString())) {
          throw new AppError(400, 'VALIDATION_ERROR', '同一题目的选项 id 不能重复');
        }
        usedOptionIds.add(optionId.toHexString());
        optionIdByClientId.set(option.clientId, optionId);

        return { _id: optionId, order: index + 1, label: option.label };
      });

      const jumpRules = (input.jumpRules || []).map((rule, index) => {
        const rawValue = rule.when?.value;
        let whenValue;

        if (input.type === 'single') {
          const optionId = optionIdByClientId.get(String(rawValue));
          if (!optionId) {
            throw new AppError(422, 'JUMP_INVALID', '单选跳转引用了不存在的选项');
          }
          whenValue = optionId;
        } else if (input.type === 'multiple') {
          if (!Array.isArray(rawValue)) {
            throw new AppError(422, 'JUMP_INVALID', '多选 setEq 必须是选项数组');
          }
          whenValue = rawValue.map((value) => {
            const optionId = optionIdByClientId.get(String(value));
            if (!optionId) {
              throw new AppError(422, 'JUMP_INVALID', '多选跳转引用了不存在的选项');
            }
            return optionId;
          });
        } else if (input.type === 'number') {
          whenValue = Array.isArray(rawValue)
            ? rawValue.map((value) => Number(value))
            : Number(rawValue);
        } else {
          whenValue = rawValue;
        }

        let target;
        if (!rule.target || rule.target.type === 'end') {
          target = { type: 'end' };
        } else if (rule.target.type === 'question') {
          const targetId = questionIdByClientId.get(String(rule.target.clientId));
          if (!targetId) {
            throw new AppError(422, 'JUMP_INVALID', '跳转目标题目不存在');
          }
          target = { type: 'question', questionId: targetId };
        } else {
          throw new AppError(422, 'JUMP_INVALID', '未知跳转目标类型');
        }

        return {
          priority: Number(rule.priority ?? index + 1),
          when: { operator: rule.when?.operator, value: whenValue },
          target
        };
      });

      return {
        _id: questionId,
        order,
        type: input.type,
        title: input.title,
        required: input.required ?? false,
        options,
        validation: normalizeValidation(input.type, input.validation || {}),
        jumpRules,
        ...(input.questionVersionId
          ? { questionVersionId: new ObjectId(input.questionVersionId) }
          : {}),
        ...(input.questionFamilyId
          ? { questionFamilyId: new ObjectId(input.questionFamilyId) }
          : {}),
        ...(input.questionVersion != null
          ? { questionVersion: Number(input.questionVersion) }
          : {})
      };
    });

    if (saved.length > 0) {
      for (const question of saved) {
        validateQuestionStructure(question);
      }
      validateSurveyForPublish({ ...survey, questions: saved });
    }

    const { surveys } = getCollections();
    const result = await surveys.updateOne(
      {
        _id: survey._id,
        ownerId: ownerIdOf(req),
        status: 'draft'
      },
      {
        $set: {
          questions: saved,
          updatedAt: new Date()
        }
      }
    );

    if (result.matchedCount !== 1) {
      throw new AppError(409, 'SURVEY_LOCKED', '问卷状态已变化，请刷新后重试');
    }
    res.json({ questions: saved.map(toPlain) });
  })
);

router.patch(
  '/:id/questions/:questionId',
  asyncHandler(async (req, res) => {
    const survey = await findOwnedSurvey(req);
    ensureDraft(survey);
    const questionId = questionIdOf(req);
    const index = (survey.questions || []).findIndex(
      (question) => idOf(question._id) === idOf(questionId)
    );
    if (index < 0) {
      throw new AppError(404, 'NOT_FOUND', '题目不存在');
    }

    const patch = parse(questionPatchSchema, req.body);
    const existing = survey.questions[index];
    const existingInput = existingQuestionToInput(existing);
    const mergedInput = {
      ...existingInput,
      ...patch,
      options: patch.options !== undefined ? patch.options : existingInput.options,
      validation: patch.validation !== undefined ? patch.validation : existing.validation,
      jumpRules: patch.jumpRules !== undefined ? patch.jumpRules : existing.jumpRules
    };
    const updatedQuestion = normalizeQuestionInput(mergedInput, {
      order: existing.order,
      existing
    });
    validateQuestionStructure(updatedQuestion);

    const questions = [...survey.questions];
    questions[index] = updatedQuestion;
    const { surveys } = getCollections();
    const result = await surveys.updateOne(
      {
        _id: survey._id,
        ownerId: ownerIdOf(req),
        status: 'draft'
      },
      {
        $set: {
          questions,
          updatedAt: new Date()
        }
      }
    );

    if (result.modifiedCount !== 1) {
      throw new AppError(409, 'SURVEY_LOCKED', '问卷状态已变化，请刷新后重试');
    }
    res.json(toPlain(updatedQuestion));
  })
);

router.delete(
  '/:id/questions/:questionId',
  asyncHandler(async (req, res) => {
    const survey = await findOwnedSurvey(req);
    ensureDraft(survey);
    const questionId = questionIdOf(req);
    const remaining = (survey.questions || []).filter(
      (question) => idOf(question._id) !== idOf(questionId)
    );
    if (remaining.length === (survey.questions || []).length) {
      throw new AppError(404, 'NOT_FOUND', '题目不存在');
    }

    const cleaned = reindexQuestions(remaining).map((question) => ({
      ...question,
      jumpRules: (question.jumpRules || []).filter(
        (rule) =>
          rule.target?.type !== 'question' ||
          idOf(rule.target.questionId) !== idOf(questionId)
      )
    }));

    const { surveys } = getCollections();
    await surveys.updateOne(
      {
        _id: survey._id,
        ownerId: ownerIdOf(req),
        status: 'draft'
      },
      {
        $set: {
          questions: cleaned,
          updatedAt: new Date()
        }
      }
    );
    res.status(204).end();
  })
);

router.put(
  '/:id/questions/order',
  asyncHandler(async (req, res) => {
    const survey = await findOwnedSurvey(req);
    ensureDraft(survey);
    const { questionIds } = parse(reorderSchema, req.body);
    const existingIds = (survey.questions || []).map((question) => idOf(question._id));
    const uniqueIds = new Set(questionIds);
    if (
      questionIds.length !== existingIds.length ||
      uniqueIds.size !== questionIds.length ||
      !questionIds.every((id) => existingIds.includes(id))
    ) {
      throw new AppError(400, 'VALIDATION_ERROR', 'questionIds 必须包含全部题目且不能重复');
    }

    const questionById = new Map(
      (survey.questions || []).map((question) => [idOf(question._id), question])
    );
    const reordered = questionIds.map((id, index) => ({
      ...questionById.get(id),
      order: index + 1
    }));

    const { surveys } = getCollections();
    await surveys.updateOne(
      {
        _id: survey._id,
        ownerId: ownerIdOf(req),
        status: 'draft'
      },
      {
        $set: {
          questions: reordered,
          updatedAt: new Date()
        }
      }
    );
    res.json(reordered.map(toPlain));
  })
);

router.post(
  '/:id/publish',
  asyncHandler(async (req, res) => {
    const survey = await findOwnedSurvey(req);
    ensureDraft(survey);
    validateSurveyForPublish(survey);

    const { surveys } = getCollections();
    let updated = null;
    let lastError = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const slug = randomSlug();
      try {
        updated = await surveys.findOneAndUpdate(
          {
            _id: survey._id,
            ownerId: ownerIdOf(req),
            status: 'draft'
          },
          {
            $set: {
              status: 'published',
              slug,
              publishedAt: new Date(),
              updatedAt: new Date()
            }
          },
          { returnDocument: 'after' }
        );
        if (updated) break;
      } catch (error) {
        lastError = error;
        if (error?.code !== 11000) throw error;
      }
    }

    if (!updated) {
      if (lastError) {
        throw new AppError(500, 'SLUG_GENERATION_FAILED', '生成问卷链接失败，请重试');
      }
      throw new AppError(409, 'SURVEY_LOCKED', '问卷状态已变化，请刷新后重试');
    }

    res.json({
      id: idOf(updated._id),
      status: updated.status,
      slug: updated.slug,
      url: `${config.publicBaseUrl}/survey/${updated.slug}`
    });
  })
);

router.post(
  '/:id/close',
  asyncHandler(async (req, res) => {
    const survey = await findOwnedSurvey(req);
    if (survey.status !== 'published') {
      throw new AppError(409, 'SURVEY_LOCKED', '只有已发布的问卷可以关闭');
    }

    const { surveys } = getCollections();
    const updated = await surveys.findOneAndUpdate(
      {
        _id: survey._id,
        ownerId: ownerIdOf(req),
        status: 'published'
      },
      {
        $set: {
          status: 'closed',
          closedAt: new Date(),
          updatedAt: new Date()
        }
      },
      { returnDocument: 'after' }
    );
    if (!updated) {
      throw new AppError(409, 'SURVEY_LOCKED', '问卷状态已变化，请刷新后重试');
    }
    res.json(toPlain(updated));
  })
);

export default router;
