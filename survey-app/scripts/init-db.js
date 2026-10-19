import { connectDb, ensureSchema, closeDb } from '../src/db.js';
import { config } from '../src/config.js';

try {
  await connectDb();
  await ensureSchema();
  console.log(`MongoDB 初始化完成: ${config.mongoUri}/${config.mongoDb}`);
} catch (error) {
  console.error('MongoDB 初始化失败:', error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
