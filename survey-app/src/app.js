import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import authRoutes from './routes/auth.js';
import surveyRoutes from './routes/surveys.js';
import fillRoutes from './routes/fill.js';
import statsRoutes from './routes/stats.js';
import { AppError } from './errors.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(moduleDir, '..', 'public');

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(publicDir));

  app.get('/login', (req, res) => {
    res.sendFile(path.join(publicDir, 'login.html'));
  });

  app.get('/register', (req, res) => {
    res.sendFile(path.join(publicDir, 'register.html'));
  });

  app.get('/create', (req, res) => {
    res.sendFile(path.join(publicDir, 'create.html'));
  });

  app.get('/my-response/:slug', (req, res) => {
    res.sendFile(path.join(publicDir, 'response.html'));
  });

  app.get('/results/:id', (req, res) => {
    res.sendFile(path.join(publicDir, 'results.html'));
  });

  app.get('/survey/:slug', (req, res) => {
    res.sendFile(path.join(publicDir, 'survey.html'));
  });

  app.get('/health', (req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/surveys', surveyRoutes);
  app.use('/api/fill', fillRoutes);
  app.use('/api/surveys', statsRoutes);

  app.use((req, res, next) => {
    next(new AppError(404, 'NOT_FOUND', '接口不存在'));
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);

    if (error instanceof AppError) {
      return res.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {})
        }
      });
    }

    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: '请求体不是合法的 JSON'
        }
      });
    }

    if (error?.code === 11000) {
      return res.status(409).json({
        error: {
          code: 'DUPLICATE_KEY',
          message: '数据已存在或违反唯一约束'
        }
      });
    }

    console.error(error);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: '服务器内部错误'
      }
    });
  });

  return app;
}
