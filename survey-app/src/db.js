import { MongoClient } from 'mongodb';
import { config } from './config.js';

let client;
let database;

export async function connectDb(options = {}) {
  if (database) return database;

  const uri = options.uri || config.mongoUri;
  const dbName = options.dbName || config.mongoDb;
  client = new MongoClient(uri);
  await client.connect();
  database = client.db(dbName);
  return database;
}

export function getDb() {
  if (!database) {
    throw new Error('MongoDB 尚未连接，请先调用 connectDb()');
  }
  return database;
}

export function getCollections() {
  const db = getDb();
  return {
    users: db.collection('users'),
    surveys: db.collection('surveys'),
    responses: db.collection('responses')
  };
}

export async function closeDb() {
  if (client) {
    await client.close();
  }
  client = undefined;
  database = undefined;
}

async function createCollectionIfMissing(name, options) {
  const db = getDb();
  const existing = await db.listCollections({ name }).toArray();
  if (existing.length === 0) {
    await db.createCollection(name, options);
  }
}

const usersValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['_id', 'username', 'passwordHash', 'createdAt', 'updatedAt'],
    properties: {
      _id: { bsonType: 'objectId' },
      username: { bsonType: 'string', minLength: 3, maxLength: 32 },
      passwordHash: { bsonType: 'string' },
      createdAt: { bsonType: 'date' },
      updatedAt: { bsonType: 'date' }
    },
    additionalProperties: false
  }
};

const surveysValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: [
      '_id',
      'ownerId',
      'title',
      'description',
      'status',
      'allowAnonymous',
      'allowMultipleResponses',
      'version',
      'createdAt',
      'updatedAt',
      'questions'
    ],
    properties: {
      _id: { bsonType: 'objectId' },
      ownerId: { bsonType: 'objectId' },
      title: { bsonType: 'string', minLength: 1, maxLength: 200 },
      description: { bsonType: 'string', maxLength: 2000 },
      slug: { bsonType: 'string' },
      status: { enum: ['draft', 'published', 'closed'] },
      allowAnonymous: { bsonType: 'bool' },
      allowMultipleResponses: { bsonType: 'bool' },
      deadline: { bsonType: ['date', 'null'] },
      version: { bsonType: 'number' },
      createdAt: { bsonType: 'date' },
      updatedAt: { bsonType: 'date' },
      publishedAt: { bsonType: ['date', 'null'] },
      closedAt: { bsonType: ['date', 'null'] },
      questions: { bsonType: 'array' }
    },
    additionalProperties: false
  }
};

const responsesValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: [
      '_id',
      'surveyId',
      'surveyVersion',
      'submissionId',
      'anonymous',
      'answers',
      'submittedAt'
    ],
    properties: {
      _id: { bsonType: 'objectId' },
      surveyId: { bsonType: 'objectId' },
      surveyVersion: { bsonType: 'number' },
      submissionId: { bsonType: 'string', minLength: 8, maxLength: 64 },
      respondentId: { bsonType: ['objectId', 'null'] },
      anonymous: { bsonType: 'bool' },
      dedupeKey: { bsonType: 'string' },
      answers: {
        bsonType: 'array',
        minItems: 1,
        items: {
          bsonType: 'object',
          required: ['questionId', 'type', 'value'],
          properties: {
            questionId: { bsonType: 'objectId' },
            type: { enum: ['single', 'multiple', 'text', 'number'] },
            value: {
              bsonType: ['objectId', 'string', 'int', 'long', 'double', 'array']
            }
          },
          additionalProperties: false
        }
      },
      startedAt: { bsonType: 'date' },
      submittedAt: { bsonType: 'date' },
      durationMs: { bsonType: 'number' }
    },
    additionalProperties: false
  }
};

export async function ensureSchema() {
  const db = getDb();

  await createCollectionIfMissing('users', {
    validator: usersValidator,
    validationLevel: 'strict',
    validationAction: 'error'
  });
  await createCollectionIfMissing('surveys', {
    validator: surveysValidator,
    validationLevel: 'strict',
    validationAction: 'error'
  });
  await createCollectionIfMissing('responses', {
    validator: responsesValidator,
    validationLevel: 'strict',
    validationAction: 'error'
  });

  await db.collection('users').createIndexes([
    { key: { username: 1 }, name: 'uniq_username', unique: true }
  ]);

  await db.collection('surveys').createIndexes([
    {
      key: { slug: 1 },
      name: 'uniq_slug',
      unique: true,
      partialFilterExpression: { slug: { $type: 'string' } }
    },
    { key: { ownerId: 1, createdAt: -1 }, name: 'owner_created' },
    { key: { status: 1, deadline: 1 }, name: 'status_deadline' }
  ]);

  await db.collection('responses').createIndexes([
    { key: { surveyId: 1, submittedAt: -1 }, name: 'survey_submitted' },
    { key: { surveyId: 1, respondentId: 1 }, name: 'survey_respondent' },
    { key: { surveyId: 1, 'answers.questionId': 1 }, name: 'survey_answer_question' },
    {
      key: { surveyId: 1, submissionId: 1 },
      name: 'uniq_survey_submission',
      unique: true
    },
    {
      key: { dedupeKey: 1 },
      name: 'uniq_dedupe',
      unique: true,
      sparse: true
    }
  ]);
}
