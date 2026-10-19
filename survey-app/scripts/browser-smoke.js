import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const chrome =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const screenshotPath = path.join(moduleDir, '..', '.data', 'smoke-failure.png');

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});

const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
page.on('dialog', async (dialog) => {
  await dialog.accept();
});
page.on('console', (message) => {
  if (message.type() === 'error') {
    errors.push(`console: ${message.text()}`);
  }
});

try {
  const username = `ui_${Date.now()}`;

  await page.goto(`${base}/register`, { waitUntil: 'networkidle0' });
  await page.type('#username', username);
  await page.type('#password', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => location.pathname === '/');
  await page.waitForSelector('#dashboard:not(.hidden)');
  const userHeader = await page.$eval(
    '#userName',
    (element) => element.textContent
  );
  if (!userHeader.includes('注册时间：')) {
    throw new Error('首页没有显示当前用户的注册时间');
  }

  const cachedUsername = await page.evaluate(() =>
    localStorage.getItem('survey_last_username')
  );
  if (cachedUsername !== username) {
    throw new Error('最近登录用户名没有缓存');
  }
  await page.goto(`${base}/login`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#username');
  const prefilledUsername = await page.$eval(
    '#username',
    (input) => input.value
  );
  if (prefilledUsername !== username) {
    throw new Error('登录页没有自动填入最近登录用户名');
  }
  await page.$eval('#username', (input) => {
    input.value = '';
  });
  await page.click('.user-chip');
  const refilledUsername = await page.$eval(
    '#username',
    (input) => input.value
  );
  if (refilledUsername !== username) {
    throw new Error('点击最近登录用户名没有重新填入');
  }

  await page.goto(`${base}/create`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.builder-question');

  await page.type('#surveyTitleInput', '浏览器冒烟测试问卷');
  await page.type(
    '.builder-question [data-field="title"]',
    '你的性别'
  );

  const firstOptions = await page.$$(
    '.builder-question [data-field="option-label"]'
  );
  await firstOptions[0].type('男');
  await firstOptions[1].type('女');

  await page.click('#addQuestionBtn');
  let cards = await page.$$('.builder-question');
  let secondCard = cards[1];
  await (await secondCard.$('[data-field="type"]')).select('number');

  cards = await page.$$('.builder-question');
  secondCard = cards[1];
  await (await secondCard.$('[data-field="title"]')).type('你的年龄');
  await (await secondCard.$('[data-field="required"]')).click();

  await page.evaluate(() => {
    const card = document.querySelectorAll('.builder-question')[1];
    const min = card.querySelector('input[data-field="min"]');
    const max = card.querySelector('input[data-field="max"]');
    min.value = '5';
    min.dispatchEvent(new Event('input', { bubbles: true }));
    max.value = '-9';
    max.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => {
    const card = document.querySelectorAll('.builder-question')[1];
    return card
      .querySelector('[data-range-error]')
      .textContent.includes('最大值不能小于最小值');
  });
  const rangeBlocked = await page.$eval(
    '#saveDraftBtn',
    (button) => button.disabled
  );
  if (!rangeBlocked) {
    throw new Error('最大值小于最小值时没有阻止保存');
  }
  await page.evaluate(() => {
    const card = document.querySelectorAll('.builder-question')[1];
    const min = card.querySelector('input[data-field="min"]');
    const max = card.querySelector('input[data-field="max"]');
    min.value = '0';
    min.dispatchEvent(new Event('input', { bubbles: true }));
    max.value = '120';
    max.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => !document.querySelector('#saveDraftBtn').disabled);

  await page.click('.builder-question [data-action="add-rule"]');
  await page.waitForSelector('.rule-box');
  await page.click('.rule-box [data-action="remove-rule"]');

  await page.click('#saveDraftBtn');
  await page.waitForFunction(
    () => document.getElementById('message').textContent.includes('草稿已保存')
  );

  await page.click('#savePublishBtn');
  await page.waitForFunction(
    () => document.getElementById('noticeMessage').textContent.includes('问卷已发布')
  );

  const fillHref = await page.$eval('#noticeMessage a', (link) =>
    link.getAttribute('href')
  );
  await page.goto(`${base}${fillHref}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.question-card');
  await page.click('.question-card input[type="radio"]');
  await page.type('.question-card input[type="number"]', '20.5');
  await page.click('#submitBtn');
  await page.waitForFunction(
    () => document.getElementById('pageMessage').textContent.includes('提交成功')
  );

  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#dashboard:not(.hidden)');
  await page.click('.tab[data-tab="filled"]');
  await page.waitForFunction(() => {
    const tab = document.querySelector('.tab[data-tab="filled"]');
    const list = document.getElementById('surveyList');
    return (
      tab?.classList.contains('active') &&
      list.textContent.includes('浏览器冒烟测试问卷') &&
      [...list.querySelectorAll('a')].some((link) =>
        link.textContent.includes('查看填写内容')
      )
    );
  });

  await page.evaluate(() => {
    [...document.querySelectorAll('#surveyList a')]
      .find((link) => link.textContent.includes('查看填写内容'))
      .click();
  });
  await page.waitForSelector('.response-card');
  const readonlyFields = await page.$$eval(
    '.response-card input, .response-card textarea',
    (elements) => elements.filter((element) => element.disabled).length
  );
  if (readonlyFields === 0) {
    throw new Error('我的答卷页面没有只读字段');
  }

  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#dashboard:not(.hidden)');
  await page.click('.tab[data-tab="published"]');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.survey-item')].some(
      (card) =>
        card.textContent.includes('浏览器冒烟测试问卷') &&
        card.querySelector('a[href^="/results/"]')
    )
  );
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('.survey-item')].find((item) =>
      item.textContent.includes('浏览器冒烟测试问卷')
    );
    card.querySelector('a[href^="/results/"]').click();
  });
  await page.waitForSelector('#resultContent:not(.hidden)');
  const respondentsText = await page.$eval(
    '#respondentList',
    (element) => element.textContent
  );
  if (!respondentsText.includes('用户：')) {
    throw new Error('结果页没有显示作答用户');
  }
  const statsText = await page.$eval('#statsList', (element) => element.textContent);
  if (!statsText.includes('你的性别')) {
    throw new Error('结果页没有显示题目统计');
  }
  await page.click('.tab[data-tab="responses"]');
  const responseText = await page.$eval(
    '#responseList',
    (element) => element.textContent
  );
  if (!responseText.includes('你的年龄') || !responseText.includes('用户：')) {
    throw new Error('结果页没有显示作答用户或答案');
  }

  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#dashboard:not(.hidden)');
  await page.click('.tab[data-tab="published"]');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.survey-item')].some(
      (card) =>
        card.textContent.includes('浏览器冒烟测试问卷') &&
        card.querySelector('button[data-action="close"]')
    )
  );
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('.survey-item')].find((item) =>
      item.textContent.includes('浏览器冒烟测试问卷')
    );
    card.querySelector('button[data-action="close"]').click();
  });
  await page.waitForFunction(() => {
    const card = [...document.querySelectorAll('.survey-item')].find((item) =>
      item.textContent.includes('浏览器冒烟测试问卷')
    );
    return card && card.textContent.includes('已关闭');
  });
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('.survey-item')].find((item) =>
      item.textContent.includes('浏览器冒烟测试问卷')
    );
    card.querySelector('a[href^="/create?id="]').click();
  });
  await page.waitForFunction(() =>
    document.getElementById('pageTitle').textContent.includes('只读')
  );
  const disabledBuilderFields = await page.$$eval(
    '#questionList input, #questionList select, #questionList textarea',
    (elements) => elements.filter((element) => element.disabled).length
  );
  if (disabledBuilderFields === 0) {
    throw new Error('已关闭问卷的只读页面没有禁用编辑控件');
  }

  console.log('browser smoke ok');
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.error(`screenshot: ${screenshotPath}`);
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
