# MongoDB 在线问卷系统

基于 MongoDB + Node.js + Express 的简化问卷系统后端。当前已实现：

- 注册、登录、JWT 鉴权；
- 问卷草稿、题目增删改、排序、发布、关闭；
- 可视化问卷编辑器：问卷设置、四种题型、选项、校验、跳转规则、保存草稿/发布；
- 单选、多选、文本、数字四种题型；
- 题目校验、单选/多选/数字跳转；
- 多选跳转按集合精确匹配（`setEq`）；
- 单页填写所需的完整题目和跳转规则接口；
- 答卷提交、匿名、重复限制、`submissionId` 幂等；
- 整卷/单题统计、文本答案分页、答卷列表。
- 第二阶段题库：题目保存、复用、共享链接、版本历史、恢复、另存新题、使用问卷和跨问卷统计。

已提供一个最小前端：

- `/login`：登录页；
- `/register`：注册页；
- `/`：登录后的“我发布的 / 我填写的”列表、创建问卷、编辑草稿、打开填写页；
- `/create`：完整问卷编辑器（新建）；`/create?id=...` 编辑草稿；已关闭问卷从首页“查看问卷”进入只读模式；
- `/question-bank`：题库管理、版本历史、共享链接、使用问卷和跨问卷统计；
- `/shared-question/:token`：登录后查看共享题目快照，并可复制链接；
- `/survey/:slug`：登录后单页填写，支持条件显示/隐藏、自动滚动、校验和提交。
- `/my-response/:slug`：只读查看自己在“我填写的”里提交过的答案。
- `/results/:id`：问卷创建者查看统计结果、作答用户列表（含用户名、提交时间）和每一份作答。

## 环境要求

- Node.js >= 20（当前使用 Node.js 22 验证）；
- MongoDB 6/7/8（本机已使用 MongoDB 验证）。

## 一键启动（Windows）

在项目根目录双击：

```text
start-survey.bat
```

或在 PowerShell 中运行：

```powershell
cd D:\a绝密\数据库26\大作业1
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-survey.ps1
```

脚本会自动完成：

1. 检查 Node.js/npm；
2. 首次运行时生成 `.env`、安装 npm 依赖；
3. 启动 MongoDB（数据目录 `survey-app\.data\db`）；
4. 初始化数据库（幂等）；
5. 启动 API；
6. 等待健康检查通过后打开浏览器。

停止服务：

```text
stop-survey.bat
```

日志位置：

```text
survey-app\.data\server.out.log
survey-app\.data\server.err.log
survey-app\.data\mongod.log
```

重复双击 `start-survey.bat` 不会重复启动：如果服务已经在运行，只会打开浏览器。

## 手动启动

```powershell
cd survey-app
Copy-Item .env.example .env
npm install
```

如果 npm 默认缓存在本机没有写权限，可以改用项目内缓存：

```powershell
npm install --cache .npm-cache
```

先启动 MongoDB，例如：

```powershell
New-Item -ItemType Directory -Force .data\db
mongod --dbpath .data\db --port 27017
```

另开一个终端初始化数据库并启动 API：

```powershell
npm run init-db
npm start
```

服务默认监听 `http://localhost:3000`，健康检查：

```powershell
Invoke-RestMethod http://localhost:3000/health
```

浏览器打开 `http://localhost:3000` 即可进入最小前端。登录后点“创建并发布示例问卷”会自动生成一份带单选、多选、文本、数字题和精确匹配跳转的问卷。

## 测试

完整的测试步骤、输入、预期输出和实际结果见 [../docs/测试用例.md](../docs/测试用例.md)。

测试会使用 `survey_app_test` 数据库，并在开始/结束时清空该库，不会动开发库：

```powershell
npm test
```

当前测试覆盖（25 个自动化测试）：

- 多选 `setEq` 精确匹配、顺序无关、多选/少选不触发；
- 必答题在提交模式报错、预览模式继续；
- 文本长度按 Unicode code point 计算；
- 发布校验拒绝向后跳转和永远不会命中的 `setEq`；
- 完整 API 流程：注册、建卷、加题、发布、填写、幂等提交、冲突、重复限制、统计、匿名答卷、发布后锁题、关闭后拒绝填写。
- 题库版本、共享链接、题库隔离、共享快照隔离、使用关系和跨问卷统计。

浏览器冒烟测试（需要本机 Chrome，且 API 服务已启动）：

```powershell
npm run smoke
```

它会真实打开页面，完成注册、创建问卷、保存草稿、发布、打开填写页并提交，然后检查“我填写的”只读答卷页、创建者的统计/作答明细页，以及关闭后的只读问卷页。
默认使用 `C:\Program Files\Google\Chrome\Application\chrome.exe`，如有不同可通过 `CHROME_PATH` 指定。

## 主要接口

所有业务接口都需要：

```http
Authorization: Bearer <token>
```

### 认证

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | 注册 |
| POST | `/api/auth/login` | 登录 |
| GET | `/api/auth/me` | 当前用户 |
| POST | `/api/auth/logout` | 退出（无服务端状态） |

### 我的问卷

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/surveys` | 我的问卷列表 |
| GET | `/api/surveys/filled` | 我填写过的问卷（仅记名答卷） |
| POST | `/api/surveys` | 创建草稿 |
| GET | `/api/surveys/:id` | 问卷详情 |
| PATCH | `/api/surveys/:id` | 修改标题、说明、截止时间 |
| DELETE | `/api/surveys/:id` | 删除无答卷的草稿 |
| POST | `/api/surveys/:id/questions` | 添加题目 |
| PUT | `/api/surveys/:id/questions` | 批量保存题目（编辑器使用） |
| PATCH | `/api/surveys/:id/questions/:questionId` | 修改题目 |
| DELETE | `/api/surveys/:id/questions/:questionId` | 删除题目 |
| PUT | `/api/surveys/:id/questions/order` | 重排题目 |
| POST | `/api/surveys/:id/publish` | 发布并生成 slug |
| POST | `/api/surveys/:id/close` | 关闭问卷 |

### 填写

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/fill/surveys/:slug` | 获取全部题目和跳转规则 |
| GET | `/api/fill/surveys/:slug/my-responses` | 查看我提交过的记名答卷（只读） |
| POST | `/api/fill/surveys/:slug/responses` | 提交答卷 |

提交示例：

```json
{
  "submissionId": "5c2f9d1e-7a4b-4f0e-9c3a-2b6d8e1f4a70",
  "answers": [
    { "questionId": "...", "value": "..." },
    { "questionId": "...", "value": ["...", "..."] },
    { "questionId": "...", "value": "文本" },
    { "questionId": "...", "value": 20 }
  ],
  "startedAt": "2026-10-18T10:10:00.000Z"
}
```

### 统计与答卷

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/surveys/:id/stats` | 整卷统计 |
| GET | `/api/surveys/:id/questions/:questionId/stats` | 单题统计 |
| GET | `/api/surveys/:id/questions/:questionId/answers` | 文本答案分页 |
| GET | `/api/surveys/:id/responses` | 答卷列表 |
| GET | `/api/surveys/:id/responses/:responseId` | 答卷详情 |

### 题库

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/question-bank` | 当前用户自己的题目 |
| POST | `/api/question-bank` | 创建题目 v1 |
| GET | `/api/question-bank/:id` | 查看指定版本 |
| GET | `/api/question-bank/:familyId/history` | 版本历史 |
| POST | `/api/question-bank/:id/versions` | 基于版本创建新版本 |
| POST | `/api/question-bank/:id/restore` | 恢复旧版本 |
| POST | `/api/question-bank/:id/derive` | 另存为新题 |
| GET | `/api/question-bank/:familyId/usages` | 使用该题目的问卷 |
| GET | `/api/question-bank/:familyId/stats` | 跨问卷统计 |

### 共享题目链接

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/shared-questions` | 保存题目快照并生成共享链接 |
| GET | `/api/shared-questions/:token` | 登录后读取共享题目快照 |

## 已落实的设计口径

- **全站登录**：除注册、登录外，创建、编辑、发布、填写、提交、统计都要求登录。
- **匿名**：`allowAnonymous=true` 时答卷不保存 `respondentId`；创建者看不到填写者身份。系统内部仍用 HMAC `dedupeKey` 防重复，但接口不返回该字段。
- **我填写的**：按 `respondentId` 查询记名答卷；匿名问卷不会出现在“我填写的”里，以保持匿名性。
- **最近登录用户**：登录/注册成功后把用户名缓存在 `localStorage`，保留最近 5 个；登录页和填写页会自动填入最近一个，也可以点击用户名标签重新填入。只缓存用户名，不缓存密码。
- **发布后锁题**：`published` 后题目、选项、校验、跳转规则不可修改；标题、说明、截止时间可改；`closed` 后不可重新开放。
- **单页扁平填写**：接口一次返回全部题目和跳转规则，前端负责显示/隐藏和滚动；服务端提交时重新计算路径。
- **多选跳转**：只支持 `setEq`，即选中集合与配置集合完全一致，顺序无关。
- **数字题**：发布者设置最小值/最大值和数字类型；整数模式只接受整数，小数模式接受整数和小数，二者都必须落在设置范围内。最大值小于最小值时输入框标红、即时提示并阻止保存。
- **题库与版本**：`question_versions` 保存题目版本，问卷保存题目快照并记录 `questionFamilyId` / `questionVersionId`；题库新版本不会改变已发布问卷，历史版本可查看和恢复，支持另存新题、使用问卷查询和跨问卷统计。
- **独立使用历史版本**：版本历史中的每个版本都有“用于新问卷”入口；问卷编辑器的题库选择列表也会逐个显示最新版和历史版。`GET /api/question-bank?versions=all` 返回全部版本，v1、v2 等可以分别添加到同一份或不同问卷。
- **共享链接**：题库默认私有。生成共享链接时先把题目保存为当前用户的题库版本，再把不可变题目快照写入 `shared_questions` 并返回随机 token；因此从问卷编辑器共享的题目也会出现在自己的题库。其他用户登录后粘贴链接导入当前问卷，不会自动在题库中看到该题，也不会获得原题库的修改权限。
- **空答卷**：至少需要一个有效答案，否则返回 `EMPTY_RESPONSE`。
- **提交幂等**：同一 `{surveyId, submissionId}` 重复提交返回原 `responseId`；答案不同则返回 `SUBMISSION_CONFLICT`。
- **时间**：数据库存 UTC，接口使用带时区的 ISO 8601；创建或修改问卷时截止时间必须晚于当前时间；`submittedAt <= deadline` 视为有效。
- **统计**：实时聚合；无人回答时 `answeredCount=0`、数字题 `average=null`；百分比保留 2 位小数。

## 目录

```text
survey-app/
  src/
    app.js              # Express 应用与错误处理
    server.js           # 启动入口
    db.js               # MongoDB 连接、validator、索引
    logic.js            # 校验与跳转引擎
    routes/
      auth.js
      surveys.js
      fill.js
      stats.js
  scripts/init-db.js
  test/
    logic.test.js
    api.test.js
  public/
    index.html          # 登录后的首页：问卷列表、示例问卷
    app.js              # 首页逻辑
    login.html          # 登录页
    login.js
    register.html       # 注册页
    register.js
    api.js              # 前端共享 API/token 工具
    create.html         # 问卷编辑器
    create.js
    survey.html         # 单页填写页
    fill.js             # 填写页逻辑
    response.html       # 我的答卷只读页
    response.js
    question-bank.html  # 题库页面
    question-bank.js
    results.html        # 创建者查看统计与作答
    results.js
    styles.css
```
