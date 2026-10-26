import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { config } from '../config.js';
import { getCollections } from '../db.js';
import { authRequired } from '../auth.js';
import { AppError, asyncHandler } from '../errors.js';
import { parse, sharedQuestionCreateSchema } from '../validate.js';
import { normalizeBankQuestion } from '../questions.js';
import { validateQuestionStructure } from '../logic.js';
import { toPlain } from '../serialize.js';

const router = Router();
router.use(authRequired);

function newToken() {
  return randomBytes(9).toString('base64url');
}

function sharedView(question) {
  const plain = toPlain(question);
  delete plain.ownerId;
  return plain;
}

function sameQuestionSnapshot(source, normalized) {
  const sourceLabels = (source.options || []).map((option) => option.label);
  const normalizedLabels = (normalized.options || []).map(
    (option) => option.label
  );
  return (
    source.type === normalized.type &&
    source.title === normalized.title &&
    Boolean(source.required) === Boolean(normalized.required) &&
    isDeepStrictEqual(sourceLabels, normalizedLabels) &&
    isDeepStrictEqual(source.validation || {}, normalized.validation || {})
  );
}

async function createBankQuestion(normalized, userId, input, now) {
  const { questionVersions } = getCollections();
  const document = {
    _id: new ObjectId(),
    familyId: new ObjectId(),
    version: 1,
    ownerId: userId,
    ...normalized,
    previousVersionId: null,
    derivedFromVersionId: input.questionVersionId
      ? new ObjectId(input.questionVersionId)
      : null,
    changeNote: '从问卷编辑器共享',
    isLatest: true,
    isShared: true,
    createdAt: now,
    updatedAt: now
  };
  await questionVersions.insertOne(document);
  return document;
}

async function appendBankVersion(source, normalized, userId, now) {
  const { questionVersions } = getCollections();
  const latest = await questionVersions.findOne(
    { familyId: source.familyId },
    { sort: { version: -1 } }
  );
  const document = {
    _id: new ObjectId(),
    familyId: source.familyId,
    version: (latest?.version || 0) + 1,
    ownerId: userId,
    ...normalized,
    previousVersionId: source._id,
    derivedFromVersionId: null,
    changeNote: `问卷编辑器共享自 v${source.version}`,
    isLatest: true,
    isShared: true,
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

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parse(sharedQuestionCreateSchema, req.body);
    const normalized = normalizeBankQuestion(input.question);
    validateQuestionStructure({
      ...normalized,
      _id: new ObjectId(),
      order: 1,
      jumpRules: []
    });

    const { sharedQuestions, questionVersions } = getCollections();
    const now = new Date();
    const userId = new ObjectId(req.user.id);

    let bankQuestion = null;
    if (input.questionVersionId) {
      bankQuestion = await questionVersions.findOne({
        _id: new ObjectId(input.questionVersionId),
        ownerId: userId
      });
    }

    if (bankQuestion && sameQuestionSnapshot(bankQuestion, normalized)) {
      bankQuestion.isShared = true;
      bankQuestion.updatedAt = now;
    } else if (bankQuestion) {
      bankQuestion = await appendBankVersion(
        bankQuestion,
        normalized,
        userId,
        now
      );
    } else {
      bankQuestion = await createBankQuestion(
        normalized,
        userId,
        input,
        now
      );
    }

    const document = {
      _id: new ObjectId(),
      token: '',
      ownerId: userId,
      ...normalized,
      questionVersionId: bankQuestion._id,
      questionFamilyId: bankQuestion.familyId,
      questionVersion: bankQuestion.version,
      createdAt: now
    };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      document.token = newToken();
      try {
        await sharedQuestions.insertOne(document);
        await questionVersions.updateMany(
          { familyId: bankQuestion.familyId },
          { $set: { isShared: true, updatedAt: now } }
        );
        return res.status(201).json({
          ...sharedView(document),
          bankQuestion: toPlain(bankQuestion),
          url: `${config.publicBaseUrl}/shared-question/${document.token}`
        });
      } catch (error) {
        if (error?.code !== 11000) throw error;
      }
    }

    throw new AppError(500, 'SHARE_LINK_FAILED', '生成共享链接失败，请重试');
  })
);

router.get(
  '/:token',
  asyncHandler(async (req, res) => {
    const { sharedQuestions } = getCollections();
    const question = await sharedQuestions.findOne({ token: req.params.token });
    if (!question) {
      throw new AppError(404, 'NOT_FOUND', '共享题目不存在或链接已失效');
    }
    res.json(sharedView(question));
  })
);

export default router;
