import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { AppError } from './errors.js';
import { QUESTION_TYPES } from './logic.js';

const objectIdSchema = z
  .string()
  .regex(/^[a-fA-F0-9]{24}$/, '必须是 24 位 ObjectId');

const dateStringSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), '必须是合法的日期时间');

const futureDateStringSchema = dateStringSchema.refine(
  (value) => new Date(value).getTime() > Date.now(),
  '截止时间必须晚于当前时间'
);

export const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, '用户名至少 3 个字符')
    .max(32, '用户名最多 32 个字符'),
  password: z
    .string()
    .min(8, '密码至少 8 位')
    .max(128, '密码最多 128 位')
});

export const loginSchema = z.object({
  username: z.string().trim().min(1, '请输入用户名'),
  password: z.string().min(1, '请输入密码')
});

export const createSurveySchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional().default(''),
  allowAnonymous: z.boolean().optional().default(false),
  allowMultipleResponses: z.boolean().optional().default(false),
  deadline: futureDateStringSchema.nullable().optional().default(null)
});

export const patchSurveySchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    deadline: futureDateStringSchema.nullable().optional(),
    allowAnonymous: z.boolean().optional(),
    allowMultipleResponses: z.boolean().optional()
  })
  .strict();

export const questionInputSchema = z.object({
  type: z.enum(QUESTION_TYPES),
  title: z.string().trim().min(1).max(500),
  required: z.boolean().optional().default(false),
  options: z
    .array(
      z.object({
        id: objectIdSchema.optional(),
        label: z.string().trim().min(1).max(200)
      })
    )
    .optional()
    .default([]),
  validation: z.record(z.any()).optional().default({}),
  jumpRules: z.array(z.record(z.any())).optional().default([]),
  questionVersionId: objectIdSchema.optional(),
  questionFamilyId: objectIdSchema.optional(),
  questionVersion: z.number().int().positive().optional()
});

export const questionPatchSchema = z
  .object({
    type: z.enum(QUESTION_TYPES).optional(),
    title: z.string().trim().min(1).max(500).optional(),
    required: z.boolean().optional(),
    options: z
      .array(
        z.object({
          id: objectIdSchema.optional(),
          label: z.string().trim().min(1).max(200)
        })
      )
      .optional(),
    validation: z.record(z.any()).optional(),
    jumpRules: z.array(z.record(z.any())).optional(),
    questionVersionId: objectIdSchema.optional(),
    questionFamilyId: objectIdSchema.optional(),
    questionVersion: z.number().int().positive().optional()
  })
  .strict();

export const reorderSchema = z.object({
  questionIds: z.array(objectIdSchema).min(1)
});

export const bulkQuestionsSchema = z.object({
  questions: z
    .array(
      z.object({
        clientId: z.string().min(1).max(64),
        id: objectIdSchema.optional(),
        type: z.enum(QUESTION_TYPES),
        title: z.string().trim().min(1).max(500),
        required: z.boolean().optional().default(false),
        options: z
          .array(
            z.object({
              clientId: z.string().min(1).max(64),
              id: objectIdSchema.optional(),
              label: z.string().trim().min(1).max(200)
            })
          )
          .optional()
          .default([]),
        validation: z.record(z.any()).optional().default({}),
        jumpRules: z.array(z.record(z.any())).optional().default([]),
        questionVersionId: objectIdSchema.optional(),
        questionFamilyId: objectIdSchema.optional(),
        questionVersion: z.number().int().positive().optional()
      })
    )
    .default([])
});

export const questionBankCreateSchema = z.object({
  type: z.enum(QUESTION_TYPES),
  title: z.string().trim().min(1).max(500),
  required: z.boolean().optional().default(false),
  options: z
    .array(z.object({ label: z.string().trim().min(1).max(200) }))
    .optional()
    .default([]),
  validation: z.record(z.any()).optional().default({}),
  changeNote: z.string().max(500).optional().default('')
});

export const questionBankVersionSchema = z.object({
  type: z.enum(QUESTION_TYPES).optional(),
  title: z.string().trim().min(1).max(500).optional(),
  required: z.boolean().optional(),
  options: z
    .array(z.object({ label: z.string().trim().min(1).max(200) }))
    .optional(),
  validation: z.record(z.any()).optional(),
  changeNote: z.string().max(500).optional().default('')
});

export const sharedQuestionCreateSchema = z.object({
  question: z.object({
    type: z.enum(QUESTION_TYPES),
    title: z.string().trim().min(1).max(500),
    required: z.boolean().optional().default(false),
    options: z
      .array(z.object({ label: z.string().trim().min(1).max(200) }))
      .optional()
      .default([]),
    validation: z.record(z.any()).optional().default({})
  }),
  questionVersionId: objectIdSchema.optional(),
  questionFamilyId: objectIdSchema.optional(),
  questionVersion: z.number().int().positive().optional()
});

export const responseSchema = z.object({
  submissionId: z.string().min(8).max(64),
  answers: z
    .array(
      z.object({
        questionId: objectIdSchema,
        value: z.any()
      })
    )
    .default([]),
  startedAt: dateStringSchema.optional()
});

export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      '请求参数不合法',
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message
      }))
    );
  }
  return result.data;
}

export function toObjectId(value, field = 'id') {
  try {
    return new ObjectId(value);
  } catch {
    throw new AppError(400, 'VALIDATION_ERROR', `${field} 不是合法的 ObjectId`);
  }
}

export function toDate(value) {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(400, 'VALIDATION_ERROR', '日期格式不合法');
  }
  return date;
}
