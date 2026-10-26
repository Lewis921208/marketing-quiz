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

// 6. 表格與數學公式不納入比對（使用者僅輸入文字段落應得 100%）
{
  const answerWithTableAndMath = `
1. 賣我們的產品：此即銷售觀念。
| 觀念 | 出發點 |
| --- | --- |
| 銷售觀念 | 工廠 |
$$ A_{kj} = \\sum_{i=1}^{n} W_{ki} B_{kij} $$
2. 製造我們能夠銷售的產品：此即行銷觀念。
`;
  const userTextOnly = '賣我們的產品：此即銷售觀念。製造我們能夠銷售的產品：此即行銷觀念。';
  const res = calcSimilarity(userTextOnly, answerWithTableAndMath);
  assert.equal(res.percent, 100, `僅輸入文字段落（忽略表格與公式）應得 100%，實得 ${res.percent}%`);
  console.log('PASS 6: 忽略 Markdown 表格與 LaTeX 公式僅比對文字 = 100%');
}

// 7. 驗證 data/questions.json 中 parse_md.py 產出的 answer_norm 與前端 JS normalizeText 完全一致
if (fs.existsSync(questionsJsonPath)) {
  const questions = JSON.parse(fs.readFileSync(questionsJsonPath, 'utf-8'));
  assert.ok(Array.isArray(questions) && questions.length > 0, 'questions.json 應為非空陣列');
  for (const q of questions) {
    assert.ok(q.answer_raw && q.answer_raw.length > 0, `題目 ${q.id} answer_raw 不可為空`);
    assert.ok(q.answer_norm && q.answer_norm.length > 0, `題目 ${q.id} answer_norm 不可為空`);
    assert.ok(Array.isArray(q.prompts) && q.prompts.length > 0, `題目 ${q.id} prompts 至少需一題`);
    const jsNorm = normalizeText(q.answer_raw);
    assert.equal(jsNorm, q.answer_norm, `題目 ${q.id} 的 Python answer_norm 與 JS normalizeText 不一致`);
    const selfSim = calcSimilarity(q.answer_raw, q.answer_raw, q.answer_norm);
    assert.equal(selfSim.percent, 100, `題目 ${q.id} 原文貼上比對必須為 100%`);
  }
  console.log(`PASS 7: data/questions.json (${questions.length} 題) Python/JS 正規化與 100% 自比對全數通過`);

  // 8. 驗證段落順序對調與同義詞微差（以 1-3 真實作答為例）能正確對齊並通過門檻 (>= 90%)
  const q13 = questions.find((q) => q.id === '1-3');
  if (q13) {
    const user13 = `產品導向：假設消費者喜愛的是品質與性能最好的產品，其管理階層致力於製造優良產品，經營重點在於提供品質最好的產品。
- 產品導向得管理階層，容易對自身產品陷入狂熱，反而對市場的需要產生盲點，而陷入最佳捕鼠器的陷阱。
- 行銷近視病：抱持產品導向的組織，易執著於產品本身，忽略顧客事實上是購買產品背後的利益，而被誤導至前途黯淡無光的產品。
生產導向：假設消費者關心的是產品的價格以及便利性，生產導向重心在於標準化與規格化。
- 經營重點在於降低成本以及提高產品的鋪貨面，廠商致力於提高生產效率以及進行廣泛的配銷。
- 競爭力來自於低廉的價格，生產導向的組織若要維持一定的利潤，必須降低成本，因此透過規模經濟、大量生產來降低成本，而量產的必要條件是規格化及標準化。
生產導向與產品導向的差異
1. 生產導向著重於標準化及規格化，達成量產，而降低成本的目的。生產導向較適合運用在產業中上游中的原物料及零組件。
2. 產品導向的組織，易過度執著於產品本身，很少或根本未考慮到顧客的需要而製造產品，忽略產品以外的可能競爭者，面臨失敗的命運。`;
    const res13 = calcSimilarity(user13, q13.answer_raw, q13.answer_norm);
    assert.ok(res13.percent >= 90, `1-3 段落對調與同義詞作答應 >= 90%，實得 ${res13.percent}%`);
    console.log(`PASS 8: 1-3 段落順序對調與同義詞真實作答 = ${res13.percent}% (>= 90% 通過)`);
  }
}
