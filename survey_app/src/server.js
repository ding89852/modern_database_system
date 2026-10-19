import { createApp } from './app.js';
import { config } from './config.js';
import { connectDb, ensureSchema, closeDb } from './db.js';

const app = createApp();

try {
  await connectDb();
  await ensureSchema();
} catch (error) {
  console.error('MongoDB 初始化失败:', error.message);
  process.exit(1);
}

const server = app.listen(config.port, () => {
  console.log(`Survey API listening on http://localhost:${config.port}`);
  console.log(`MongoDB: ${config.mongoUri}/${config.mongoDb}`);
});

async function shutdown(signal) {
  console.log(`\n收到 ${signal}，正在关闭服务...`);
  server.close(async () => {
    await closeDb();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
