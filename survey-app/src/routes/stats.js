import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { getCollections } from '../db.js';
import { authRequired } from '../auth.js';
import { AppError, asyncHandler } from '../errors.js';
import { idOf } from '../logic.js';
import { responseView } from '../serialize.js';

const router = Router();
router.use(authRequired);

function ownerIdOf(req) {
  return new ObjectId(req.user.id);
}

function parseId(value, field) {
  try {
    return new ObjectId(value);
  } catch {
    throw new AppError(400, 'VALIDATION_ERROR', `${field} 不合法`);
  }
}

async function findOwnedSurvey(req) {
  const { surveys } = getCollections();
  const survey = await surveys.findOne({
    _id: parseId(req.params.id, 'surveyId'),
    ownerId: ownerIdOf(req)
  });
  if (!survey) {
    throw new AppError(404, 'NOT_FOUND', '问卷不存在');
  }
  return survey;
}

function findQuestion(survey, questionId) {
  const question = (survey.questions || []).find(
    (item) => idOf(item._id) === idOf(questionId)
  );
  if (!question) {
    throw new AppError(404, 'NOT_FOUND', '题目不存在');
  }
  return question;
}

function percentage(count, total) {
  if (!total) return 0;
  return Math.round((count / total) * 10000) / 100;
}

async function questionStats(survey, question, responses) {
  const questionId = question._id;
  const base = {
    questionId: idOf(question._id),
    type: question.type,
    title: question.title
  };

  if (question.type === 'single') {
    const counts = await responses
      .aggregate([
        { $match: { surveyId: survey._id } },
        { $unwind: '$answers' },
        {
          $match: {
            'answers.questionId': questionId,
            'answers.type': 'single'
          }
        },
        { $group: { _id: '$answers.value', count: { $sum: 1 } } }
      ])
      .toArray();
    const countMap = new Map(counts.map((item) => [idOf(item._id), item.count]));
    const answeredCount = counts.reduce((sum, item) => sum + item.count, 0);
    return {
      ...base,
      answeredCount,
      options: (question.options || []).map((option) => {
        const count = countMap.get(idOf(option._id)) || 0;
        return {
          optionId: idOf(option._id),
          label: option.label,
          count,
          percentage: percentage(count, answeredCount)
        };
      })
    };
  }

  if (question.type === 'multiple') {
    const answeredCount = await responses.countDocuments({
      surveyId: survey._id,
      'answers.questionId': questionId
    });
    const counts = await responses
      .aggregate([
        { $match: { surveyId: survey._id } },
        { $unwind: '$answers' },
        {
          $match: {
            'answers.questionId': questionId,
            'answers.type': 'multiple'
          }
        },
        { $unwind: '$answers.value' },
        { $group: { _id: '$answers.value', count: { $sum: 1 } } }
      ])
      .toArray();
    const countMap = new Map(counts.map((item) => [idOf(item._id), item.count]));
    return {
      ...base,
      answeredCount,
      options: (question.options || []).map((option) => {
        const count = countMap.get(idOf(option._id)) || 0;
        return {
          optionId: idOf(option._id),
          label: option.label,
          count,
          percentage: percentage(count, answeredCount)
        };
      })
    };
  }

  if (question.type === 'text') {
    const total = await responses.countDocuments({
      surveyId: survey._id,
      'answers.questionId': questionId
    });
    const documents = await responses
      .find(
        {
          surveyId: survey._id,
          'answers.questionId': questionId
        },
        { projection: { answers: 1, submittedAt: 1 } }
      )
      .sort({ submittedAt: 1 })
      .limit(50)
      .toArray();
    return {
      ...base,
      answeredCount: total,
      answersTotal: total,
      answers: documents
        .map((document) =>
          (document.answers || []).find(
            (answer) => idOf(answer.questionId) === idOf(questionId)
          )
        )
        .filter(Boolean)
        .map((answer) => answer.value)
    };
  }

  const [result] = await responses
    .aggregate([
      { $match: { surveyId: survey._id } },
      { $unwind: '$answers' },
      {
        $match: {
          'answers.questionId': questionId,
          'answers.type': 'number'
        }
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          average: { $avg: '$answers.value' },
          min: { $min: '$answers.value' },
          max: { $max: '$answers.value' }
        }
      }
    ])
    .toArray();

  return {
    ...base,
    answeredCount: result?.count || 0,
    average: result?.average ?? null,
    min: result?.min ?? null,
    max: result?.max ?? null
  };
}

router.get(
  '/:id/stats',
  asyncHandler(async (req, res) => {
    const survey = await findOwnedSurvey(req);
    const { responses } = getCollections();
    const totalResponses = await responses.countDocuments({ surveyId: survey._id });
    const questions = [];
    for (const question of [...(survey.questions || [])].sort((a, b) => a.order - b.order)) {
      questions.push(await questionStats(survey, question, responses));
    }
    res.json({
      surveyId: idOf(survey._id),
      totalResponses,
      questions
    });
  })
);

router.get(
  '/:id/questions/:questionId/stats',
  asyncHandler(async (req, res) => {
    const survey = await findOwnedSurvey(req);
    const question = findQuestion(survey, parseId(req.params.questionId, 'questionId'));
    const { responses } = getCollections();
    res.json(await questionStats(survey, question, responses));
  })
);

router.get(
  '/:id/questions/:questionId/answers',
  asyncHandler(async (req, res) => {
    const survey = await findOwnedSurvey(req);
    const question = findQuestion(survey, parseId(req.params.questionId, 'questionId'));
    if (question.type !== 'text') {
      throw new AppError(400, 'VALIDATION_ERROR', '只有文本题支持查看答案列表');
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const { responses } = getCollections();
    const filter = {
      surveyId: survey._id,
      'answers.questionId': question._id
    };
    const [documents, total] = await Promise.all([
      responses
        .find(filter, { projection: { answers: 1, submittedAt: 1 } })
        .sort({ submittedAt: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
      responses.countDocuments(filter)
    ]);

    const items = documents
      .map((document) => {
        const answer = (document.answers || []).find(
          (item) => idOf(item.questionId) === idOf(question._id)
        );
        return answer
          ? { value: answer.value, submittedAt: document.submittedAt }
          : null;
      })
      .filter(Boolean);

    res.json({ items, page, pageSize, total });
  })
);

async function attachRespondents(documents) {
  const { users } = getCollections();
  const ids = [
    ...new Set(
      documents
        .map((document) => (document.anonymous ? null : idOf(document.respondentId)))
        .filter(Boolean)
    )
  ].map((id) => new ObjectId(id));

  const userDocuments = ids.length
    ? await users.find({ _id: { $in: ids } }).toArray()
    : [];
  const userMap = new Map(
    userDocuments.map((user) => [
      idOf(user._id),
      {
        id: idOf(user._id),
        username: user.username
      }
    ])
  );

  return documents.map((document) => {
    const view = responseView(document);
    if (!document.anonymous) {
      view.respondent = userMap.get(idOf(document.respondentId)) || null;
    }
    return view;
  });
}

router.get(
  '/:id/responses',
  asyncHandler(async (req, res) => {
    const survey = await findOwnedSurvey(req);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const { responses } = getCollections();
    const filter = { surveyId: survey._id };
    const [documents, total] = await Promise.all([
      responses
        .find(filter)
        .sort({ submittedAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
      responses.countDocuments(filter)
    ]);

    res.json({
      items: await attachRespondents(documents),
      page,
      pageSize,
      total
    });
  })
);

router.get(
  '/:id/responses/:responseId',
  asyncHandler(async (req, res) => {
    const survey = await findOwnedSurvey(req);
    const { responses } = getCollections();
    const response = await responses.findOne({
      _id: parseId(req.params.responseId, 'responseId'),
      surveyId: survey._id
    });
    if (!response) {
      throw new AppError(404, 'NOT_FOUND', '答卷不存在');
    }
    const [view] = await attachRespondents([response]);
    res.json(view);
  })
);

export default router;
