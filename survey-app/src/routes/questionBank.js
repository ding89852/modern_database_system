import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { getCollections } from '../db.js';
import { authRequired } from '../auth.js';
import { AppError, asyncHandler } from '../errors.js';
import {
  parse,
  questionBankCreateSchema,
  questionBankVersionSchema
} from '../validate.js';
import {
  idOf,
  validateQuestionStructure
} from '../logic.js';
import { normalizeBankQuestion } from '../questions.js';
import { toPlain } from '../serialize.js';

const router = Router();
router.use(authRequired);

function userIdOf(req) {
  return new ObjectId(req.user.id);
}

function objectIdOf(value, field) {
  try {
    return new ObjectId(value);
  } catch {
    throw new AppError(400, 'VALIDATION_ERROR', `${field} 不合法`);
  }
}

function accessFilter(userId) {
  return { ownerId: userId };
}

function validateBankQuestion(question) {
  validateQuestionStructure({
    ...question,
    _id: new ObjectId(),
    order: 1,
    jumpRules: []
  });
}

async function findAccessibleVersion(id, userId) {
  const { questionVersions } = getCollections();
  const version = await questionVersions.findOne({
    _id: objectIdOf(id, 'questionId'),
    ...accessFilter(userId)
  });
  if (!version) {
    throw new AppError(404, 'NOT_FOUND', '题目不存在或无权访问');
  }
  return version;
}

async function findAccessibleFamily(familyId, userId) {
  const { questionVersions } = getCollections();
  const version = await questionVersions.findOne({
    familyId: objectIdOf(familyId, 'familyId'),
    ...accessFilter(userId)
  });
  if (!version) {
    throw new AppError(404, 'NOT_FOUND', '题目不存在或无权访问');
  }
  return version;
}

function ensureOwner(version, userId) {
  if (idOf(version.ownerId) !== idOf(userId)) {
    throw new AppError(403, 'FORBIDDEN', '只有题目创建者可以修改或共享');
  }
}

async function latestVersionOfFamily(familyId) {
  const { questionVersions } = getCollections();
  return questionVersions.findOne(
    { familyId },
    { sort: { version: -1 } }
  );
}

async function createNextVersion(source, patch, changeNote) {
  const { questionVersions } = getCollections();
  const normalized = normalizeBankQuestion({
    type: patch.type ?? source.type,
    title: patch.title ?? source.title,
    required: patch.required ?? source.required,
    options:
      patch.options ??
      (source.options || []).map((option) => ({ label: option.label })),
    validation: patch.validation ?? source.validation
  });
  validateBankQuestion(normalized);

  const latest = await latestVersionOfFamily(source.familyId);
  const versionNumber = (latest?.version || 0) + 1;
  const now = new Date();
  const document = {
    _id: new ObjectId(),
    familyId: source.familyId,
    version: versionNumber,
    ownerId: source.ownerId,
    ...normalized,
    previousVersionId: source._id,
    derivedFromVersionId: null,
    changeNote: changeNote || '',
    isLatest: true,
    isShared: Boolean(source.isShared),
    createdAt: now,
    updatedAt: now
  };

  await questionVersions.updateMany(
    { familyId: source.familyId, isLatest: true },
    { $set: { isLatest: false, updatedAt: now } }
  );

  try {
    await questionVersions.insertOne(document);
  } catch (error) {
    await questionVersions.updateOne(
      { _id: source._id },
      { $set: { isLatest: true } }
    );
    throw error;
  }

  return document;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { questionVersions } = getCollections();
    const userId = userIdOf(req);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 50));
    const type = req.query.type ? String(req.query.type) : null;
    const query = req.query.q ? String(req.query.q).trim() : '';
    const includeAllVersions = req.query.versions === 'all';

    const filter = {
      ...(includeAllVersions ? {} : { isLatest: true }),
      ...accessFilter(userId)
    };
    if (type) filter.type = type;
    if (query) {
      filter.title = { $regex: escapeRegex(query), $options: 'i' };
    }

    const [items, total] = await Promise.all([
      questionVersions
        .find(filter)
        .sort({ updatedAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
      questionVersions.countDocuments(filter)
    ]);

    res.json({
      items: items.map(toPlain),
      page,
      pageSize,
      total
    });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parse(questionBankCreateSchema, req.body);
    const normalized = normalizeBankQuestion(input);
    validateBankQuestion(normalized);

    const { questionVersions } = getCollections();
    const now = new Date();
    const document = {
      _id: new ObjectId(),
      familyId: new ObjectId(),
      version: 1,
      ownerId: userIdOf(req),
      ...normalized,
      previousVersionId: null,
      derivedFromVersionId: null,
      changeNote: input.changeNote || '',
      isLatest: true,
      isShared: false,
      createdAt: now,
      updatedAt: now
    };
    await questionVersions.insertOne(document);
    res.status(201).json(toPlain(document));
  })
);

router.get(
  '/:familyId/history',
  asyncHandler(async (req, res) => {
    const { questionVersions } = getCollections();
    const familyId = objectIdOf(req.params.familyId, 'familyId');
    await findAccessibleFamily(familyId, userIdOf(req));
    const items = await questionVersions
      .find({ familyId })
      .sort({ version: 1 })
      .toArray();
    res.json({ items: items.map(toPlain) });
  })
);

router.get(
  '/:familyId/usages',
  asyncHandler(async (req, res) => {
    const { surveys } = getCollections();
    const familyId = objectIdOf(req.params.familyId, 'familyId');
    await findAccessibleFamily(familyId, userIdOf(req));

    const documents = await surveys
      .find(
        { 'questions.questionFamilyId': familyId },
        { projection: { title: 1, status: 1, questions: 1 } }
      )
      .sort({ updatedAt: -1 })
      .toArray();

    const items = documents.map((survey) => {
      const usedQuestions = (survey.questions || []).filter(
        (question) => idOf(question.questionFamilyId) === idOf(familyId)
      );
      return {
        id: idOf(survey._id),
        title: survey.title,
        status: survey.status,
        questionCount: usedQuestions.length,
        versions: [...new Set(
          usedQuestions.map((question) => question.questionVersion ?? null)
        )]
      };
    });

    res.json({ familyId: idOf(familyId), surveyCount: items.length, items });
  })
);

router.get(
  '/:familyId/stats',
  asyncHandler(async (req, res) => {
    const { questionVersions, surveys, responses } = getCollections();
    const familyId = objectIdOf(req.params.familyId, 'familyId');
    await findAccessibleFamily(familyId, userIdOf(req));

    const versions = await questionVersions
      .find({ familyId })
      .sort({ version: 1 })
      .toArray();
    const versionMeta = new Map(
      versions.map((version) => [idOf(version._id), version])
    );

    const surveyDocuments = await surveys
      .find(
        { 'questions.questionFamilyId': familyId },
        { projection: { title: 1, status: 1, questions: 1 } }
      )
      .toArray();

    const snapshotById = new Map();
    const surveyIds = new Set();
    for (const survey of surveyDocuments) {
      for (const question of survey.questions || []) {
        if (idOf(question.questionFamilyId) !== idOf(familyId)) continue;
        snapshotById.set(idOf(question._id), {
          surveyId: idOf(survey._id),
          surveyTitle: survey.title,
          question
        });
        surveyIds.add(idOf(survey._id));
      }
    }

    const questionIds = [...snapshotById.keys()].map((id) => new ObjectId(id));
    const responseDocuments = questionIds.length
      ? await responses
          .find(
            { 'answers.questionId': { $in: questionIds } },
            { projection: { answers: 1 } }
          )
          .toArray()
      : [];

    const statsByVersion = new Map();
    const responseIds = new Set();

    for (const response of responseDocuments) {
      for (const answer of response.answers || []) {
        const snapshot = snapshotById.get(idOf(answer.questionId));
        if (!snapshot) continue;
        responseIds.add(idOf(response._id));
        const question = snapshot.question;
        const versionId = idOf(question.questionVersionId) || `snapshot:${idOf(question._id)}`;
        const meta = versionMeta.get(idOf(question.questionVersionId));
        let stat = statsByVersion.get(versionId);
        if (!stat) {
          stat = {
            versionId,
            version: question.questionVersion ?? meta?.version ?? null,
            type: question.type,
            title: question.title,
            answeredCount: 0,
            optionCounts: new Map(),
            values: [],
            texts: []
          };
          statsByVersion.set(versionId, stat);
        }
        stat.answeredCount += 1;

        if (question.type === 'single' || question.type === 'multiple') {
          const optionIds =
            question.type === 'single'
              ? [answer.value]
              : Array.isArray(answer.value)
                ? answer.value
                : [];
          for (const optionId of optionIds) {
            const option = (question.options || []).find(
              (item) => idOf(item._id) === idOf(optionId)
            );
            const label = option?.label || '(选项已删除)';
            stat.optionCounts.set(label, (stat.optionCounts.get(label) || 0) + 1);
          }
        } else if (question.type === 'number' && typeof answer.value === 'number') {
          stat.values.push(answer.value);
        } else if (question.type === 'text' && typeof answer.value === 'string') {
          stat.texts.push(answer.value);
        }
      }
    }

    const formatStats = (stat) => {
      if (stat.type === 'single' || stat.type === 'multiple') {
        return {
          ...stat,
          optionCounts: [...stat.optionCounts.entries()]
            .map(([label, count]) => ({
              label,
              count,
              percentage: stat.answeredCount
                ? Math.round((count / stat.answeredCount) * 10000) / 100
                : 0
            }))
            .sort((a, b) => b.count - a.count),
          values: undefined,
          texts: undefined
        };
      }
      if (stat.type === 'number') {
        return {
          ...stat,
          average: stat.values.length
            ? stat.values.reduce((sum, value) => sum + value, 0) / stat.values.length
            : null,
          min: stat.values.length ? Math.min(...stat.values) : null,
          max: stat.values.length ? Math.max(...stat.values) : null,
          optionCounts: undefined
        };
      }
      return { ...stat, optionCounts: undefined, values: undefined };
    };

    const byVersion = [...statsByVersion.values()]
      .map(formatStats)
      .sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
    const types = new Set(byVersion.map((item) => item.type));

    let overall = null;
    if (types.size === 1 && byVersion.length > 0) {
      const type = byVersion[0].type;
      if (type === 'single' || type === 'multiple') {
        const counts = new Map();
        let answeredCount = 0;
        for (const stat of byVersion) {
          answeredCount += stat.answeredCount;
          for (const option of stat.optionCounts) {
            counts.set(option.label, (counts.get(option.label) || 0) + option.count);
          }
        }
        overall = {
          type,
          answeredCount,
          optionCounts: [...counts.entries()]
            .map(([label, count]) => ({
              label,
              count,
              percentage: answeredCount
                ? Math.round((count / answeredCount) * 10000) / 100
                : 0
            }))
            .sort((a, b) => b.count - a.count)
        };
      } else if (type === 'number') {
        const values = byVersion.flatMap((stat) => stat.values || []);
        overall = {
          type,
          answeredCount: values.length,
          average: values.length
            ? values.reduce((sum, value) => sum + value, 0) / values.length
            : null,
          min: values.length ? Math.min(...values) : null,
          max: values.length ? Math.max(...values) : null
        };
      } else {
        overall = {
          type,
          answeredCount: byVersion.reduce((sum, stat) => sum + stat.answeredCount, 0),
          texts: byVersion.flatMap((stat) => stat.texts || [])
        };
      }
    }

    res.json({
      familyId: idOf(familyId),
      title: versions[versions.length - 1]?.title || byVersion[0]?.title || '',
      surveyCount: surveyIds.size,
      responseCount: responseIds.size,
      versionsUsed: byVersion.length,
      mixedTypes: types.size > 1,
      byVersion,
      overall
    });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const version = await findAccessibleVersion(req.params.id, userIdOf(req));
    res.json(toPlain(version));
  })
);

router.post(
  '/:id/versions',
  asyncHandler(async (req, res) => {
    const userId = userIdOf(req);
    const source = await findAccessibleVersion(req.params.id, userId);
    ensureOwner(source, userId);
    const patch = parse(questionBankVersionSchema, req.body);
    const created = await createNextVersion(
      source,
      patch,
      patch.changeNote || ''
    );
    res.status(201).json(toPlain(created));
  })
);

router.post(
  '/:id/restore',
  asyncHandler(async (req, res) => {
    const userId = userIdOf(req);
    const source = await findAccessibleVersion(req.params.id, userId);
    ensureOwner(source, userId);
    const created = await createNextVersion(
      source,
      {},
      `恢复自 v${source.version}`
    );
    res.status(201).json(toPlain(created));
  })
);

router.post(
  '/:id/derive',
  asyncHandler(async (req, res) => {
    const userId = userIdOf(req);
    const source = await findAccessibleVersion(req.params.id, userId);
    const normalized = normalizeBankQuestion({
      type: source.type,
      title: source.title,
      required: source.required,
      options: (source.options || []).map((option) => ({ label: option.label })),
      validation: source.validation
    });
    validateBankQuestion(normalized);
    const { questionVersions } = getCollections();
    const now = new Date();
    const document = {
      _id: new ObjectId(),
      familyId: new ObjectId(),
      version: 1,
      ownerId: userId,
      ...normalized,
      previousVersionId: null,
      derivedFromVersionId: source._id,
      changeNote: `派生自 v${source.version}`,
      isLatest: true,
      isShared: false,
      createdAt: now,
      updatedAt: now
    };
    await questionVersions.insertOne(document);
    res.status(201).json(toPlain(document));
  })
);

export default router;
