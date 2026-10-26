import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT || 3000),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017',
  mongoDb: process.env.MONGODB_DB || 'survey_app',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  dedupeSecret: process.env.DEDUPE_SECRET || 'dev-only-dedupe-secret',
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:3000'
};
