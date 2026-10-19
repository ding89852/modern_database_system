import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { AppError } from './errors.js';

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

export function authRequired(req, res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new AppError(401, 'AUTH_REQUIRED', '请先登录'));
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = { id: payload.sub, username: payload.username };
    return next();
  } catch {
    return next(new AppError(401, 'AUTH_REQUIRED', '登录已失效，请重新登录'));
  }
}
