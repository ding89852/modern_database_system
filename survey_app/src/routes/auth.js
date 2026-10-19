import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { ObjectId } from 'mongodb';
import { getCollections } from '../db.js';
import { parse, registerSchema, loginSchema } from '../validate.js';
import { AppError, asyncHandler } from '../errors.js';
import { authRequired, signToken } from '../auth.js';

const router = Router();

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { username, password } = parse(registerSchema, req.body);
    const { users } = getCollections();

    const existing = await users.findOne({ username });
    if (existing) {
      throw new AppError(409, 'USERNAME_TAKEN', '用户名已存在');
    }

    const now = new Date();
    const document = {
      username,
      passwordHash: await bcrypt.hash(password, 10),
      createdAt: now,
      updatedAt: now
    };

    let result;
    try {
      result = await users.insertOne(document);
    } catch (error) {
      if (error?.code === 11000) {
        throw new AppError(409, 'USERNAME_TAKEN', '用户名已存在');
      }
      throw error;
    }

    const user = {
      id: result.insertedId.toHexString(),
      username,
      createdAt: now
    };

    res.status(201).json({ token: signToken(user), user });
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { username, password } = parse(loginSchema, req.body);
    const { users } = getCollections();
    const document = await users.findOne({ username });

    if (!document || !(await bcrypt.compare(password, document.passwordHash))) {
      throw new AppError(401, 'INVALID_CREDENTIALS', '用户名或密码错误');
    }

    const user = {
      id: document._id.toHexString(),
      username: document.username,
      createdAt: document.createdAt
    };

    res.json({ token: signToken(user), user });
  })
);

router.get(
  '/me',
  authRequired,
  asyncHandler(async (req, res) => {
    const { users } = getCollections();
    const document = await users.findOne({ _id: new ObjectId(req.user.id) });
    if (!document) {
      throw new AppError(401, 'AUTH_REQUIRED', '用户不存在或已失效');
    }
    res.json({
      user: {
        id: document._id.toHexString(),
        username: document.username,
        createdAt: document.createdAt
      }
    });
  })
);

router.post('/logout', authRequired, (req, res) => {
  res.status(204).end();
});

export default router;
