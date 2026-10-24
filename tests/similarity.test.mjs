import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const indexHtmlPath = path.join(projectRoot, 'index.html');
const questionsJsonPath = path.join(projectRoot, 'data', 'questions.json');

// 從 index.html 載入 <script id="similarity-core">，確保測試與瀏覽器執行完全同一份程式碼
const html = fs.readFileSync(indexHtmlPath, 'utf-8');
const match = html.match(/<script id="similarity-core">([\s\S]*?)<\/script>/);
assert.ok(match, 'index.html 必須包含 <script id="similarity-core">');

const sandbox = { globalThis: {} };
vm.createContext(sandbox);
vm.runInContext(match[1], sandbox);

const { normalizeText, calcSimilarity, computeDiff } = sandbox.globalThis.QuizSimilarity;
assert.equal(typeof normalizeText, 'function');
assert.equal(typeof calcSimilarity, 'function');
assert.equal(typeof computeDiff, 'function');

const sampleAnswer = `
**銷售觀念**：廠商是假設消費者對於購買商品具有惰性或抗拒，因此組織必須進行積極的銷售與促銷，消費者才會購買其產品。所以廠商的重點便是放在促銷與強銷。

1. 賣我們的產品
\t- a. 指先有產品，且不管他是否符合顧客的需要，都要想盡辦法把產品賣出去，此即銷售觀念。
![[行銷期中-BCG模式.png]]
*圖：BCG 模式，縱軸為市場成長率（來源：課本）*
`;

// 1. 完全相同 = 100%
{
  const res = calcSimilarity(sampleAnswer, sampleAnswer);
  assert.equal(res.percent, 100, `完全相同應為 100%，實得 ${res.percent}%`);
  assert.equal(res.score, 1);
  assert.equal(res.distance, 0);
  console.log('PASS 1: 完全相同 = 100%');
}

// 2. 只差標點 / 空白 / Markdown 符號 / 列表編號 / 圖片語法 = 100%
{
  const plainUserText =
    '銷售觀念廠商是假設消費者對於購買商品具有惰性或抗拒，因此組織必須進行積極的銷售與促銷！' +
    '消費者才會購買其產品；所以廠商的重點便是放在促銷與強銷。' +
    '賣我們的產品：指先有產品　且不管他是否符合顧客的需要，都要想盡辦法把產品賣出去（此即銷售觀念）';
  const res = calcSimilarity(plainUserText, sampleAnswer);
  assert.equal(res.percent, 100, `只差標點/空白/編號應為 100%，實得 ${res.percent}%`);
  assert.equal(res.distance, 0);
  console.log('PASS 2: 只差標點/空白/排版符號 = 100%');
}

// 3. 漏一句 < 90%
{
  const missingSentenceUser =
    '銷售觀念：廠商是假設消費者對於購買商品具有惰性或抗拒，因此組織必須進行積極的銷售與促銷，消費者才會購買其產品。' +
    '賣我們的產品：指先有產品，且不管他是否符合顧客的需要，都要想盡辦法把產品賣出去，此即銷售觀念。';
  // 漏掉「所以廠商的重點便是放在促銷與強銷。」（16 字 / 總長約 99 字）
  const res = calcSimilarity(missingSentenceUser, sampleAnswer);
  assert.ok(res.percent < 90 && res.percent > 50, `漏一句應 < 90%，實得 ${res.percent}%`);
  const hasMissing = res.diff.some((d) => d.type === 'missing' && d.text.includes('所以廠商的重點便是放在促銷與強銷'));
  assert.ok(hasMissing, 'LCS diff 應標示出漏寫的句子');
  console.log(`PASS 3: 漏一句 < 90% (實測 ${res.percent}%) 且 LCS 正確標出缺漏`);
}

// 4. 空白 = 0%
{
  const resEmpty = calcSimilarity('', sampleAnswer);
  assert.equal(resEmpty.percent, 0, `空白輸入應為 0%，實得 ${resEmpty.percent}%`);
  assert.equal(resEmpty.score, 0);

  const resSpaces = calcSimilarity('   \n\t  ，。！？ ', sampleAnswer);
  assert.equal(resSpaces.percent, 0, `純空白與標點輸入應為 0%，實得 ${resSpaces.percent}%`);
  console.log('PASS 4: 空白輸入 = 0%');
}

// 5. 多寫 / 錯字扣分與 LCS extra 標示驗證
{
  const extraUser = sampleAnswer + '這是一段課本沒有多寫的贅字內容';
  const res = calcSimilarity(extraUser, sampleAnswer);
  assert.ok(res.percent < 100, '多寫贅字應扣分 (< 100%)');
  const hasExtra = res.diff.some((d) => d.type === 'extra' && d.text.includes('這是一段課本沒有多寫的贅字內容'));
  assert.ok(hasExtra, 'LCS diff 應標示出多寫的字 (extra)');
  console.log(`PASS 5: 多寫扣分 (${res.percent}%) 且 LCS 正確標出刪除線`);
}

// 6. 驗證 data/questions.json 中 parse_md.py 產出的 answer_norm 與前端 JS normalizeText 完全一致
if (fs.existsSync(questionsJsonPath)) {
  const questions = JSON.parse(fs.readFileSync(questionsJsonPath, 'utf-8'));
  assert.ok(Array.isArray(questions) && questions.length > 0, 'questions.json 應為非空陣列');
  for (const q of questions) {
    assert.ok(q.answer_raw && q.answer_raw.length > 0, `題目 ${q.id} answer_raw 不可為空`);
    assert.ok(Array.isArray(q.prompts) && q.prompts.length > 0, `題目 ${q.id} prompts 至少需一題`);
    const jsNorm = normalizeText(q.answer_raw);
    assert.equal(jsNorm, q.answer_norm, `題目 ${q.id} 的 Python answer_norm 與 JS normalizeText 不一致`);
    const selfSim = calcSimilarity(q.answer_raw, q.answer_raw, q.answer_norm);
    assert.equal(selfSim.percent, 100, `題目 ${q.id} 原文貼上比對必須為 100%`);
  }
  console.log(`PASS 6: data/questions.json (${questions.length} 題) Python/JS 正規化與 100% 自比對全數通過`);
}
