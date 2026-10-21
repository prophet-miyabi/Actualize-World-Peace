#!/usr/bin/env node
// 画像スロットの管理（lp_drm テンプレート用）。Runway MCP で生成した写真を LP に差し込む。
//   node auto-sales-agent/scripts/images.js <案件ID> prompts   … input/<案件ID>/images.json（スロットと英語プロンプト）を作る／表示する
//   node auto-sales-agent/scripts/images.js <案件ID> runway    … Runway MCP（claude -p 経由）で未生成スロットを生成し input/<案件ID>/images/ に保存
//   node auto-sales-agent/scripts/images.js <案件ID> apply     … images/ の画像を dist/<案件ID>/img/ にコピーし、brief.drm.images にパスを書いて再生成
// スロット: hero / benefits[0..2] / reasons[0..2] / closing（空のままならテンプレートがグラデーション＋線画で代替する）
// 注意: Runway のクレジットが 0 のワークスペースでは runway は何も生成せずに止まる（Free プランは 0）。
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const [id, mode = 'prompts'] = process.argv.slice(2);
if (!id) { console.error('案件IDを指定してください'); process.exit(1); }
const dir = path.join(ROOT, 'input', id);
const briefPath = path.join(dir, 'brief.json');
const imagesPath = path.join(dir, 'images.json');
const imgDir = path.join(dir, 'images');
const brief = JSON.parse(fs.readFileSync(briefPath, 'utf8'));
const c = brief.client || {};
const SLOTS = ['hero', 'benefits-0', 'benefits-1', 'benefits-2', 'reasons-0', 'reasons-1', 'reasons-2', 'closing'];

const STYLE = 'Editorial photography, soft natural light, calm and clean composition, muted palette with navy and warm neutral tones, shallow depth of field, no people faces, no text, no logos, no watermarks, photorealistic, high detail.';
function defaultPrompts() {
  const d = brief.drm || {};
  const ind = c.industry || 'small business';
  const sub = (s) => (s ? ` Theme: ${s}.` : '');
  return {
    hero: { ratio: '16:9', prompt: `Wide hero photograph for a Japanese ${ind} landing page. Abstract, aspirational scene that conveys trust and long-term stability.${sub(d.hero?.eyebrow)} ${STYLE}` },
    'benefits-0': { ratio: '4:3', prompt: `Close-up detail photograph illustrating: ${d.solution?.benefits?.[0]?.after || 'simple start'}. Objects only, Japanese everyday context. ${STYLE}` },
    'benefits-1': { ratio: '4:3', prompt: `Close-up detail photograph illustrating: ${d.solution?.benefits?.[1]?.after || 'automation and calm'}. Objects only, Japanese everyday context. ${STYLE}` },
    'benefits-2': { ratio: '4:3', prompt: `Close-up detail photograph illustrating: ${d.solution?.benefits?.[2]?.after || 'transparency'}. Objects only, Japanese everyday context. ${STYLE}` },
    'reasons-0': { ratio: '4:3', prompt: `Photograph illustrating: ${d.reasons?.[0]?.title || 'reason one'}. ${STYLE}` },
    'reasons-1': { ratio: '4:3', prompt: `Photograph illustrating: ${d.reasons?.[1]?.title || 'reason two'}. ${STYLE}` },
    'reasons-2': { ratio: '4:3', prompt: `Photograph illustrating: ${d.reasons?.[2]?.title || 'reason three'}. ${STYLE}` },
    closing: { ratio: '16:9', prompt: `Dark, quiet, wide background photograph for the closing section of a Japanese ${ind} landing page: a calm evening scene suggesting peace of mind. Low contrast, lots of negative space. ${STYLE}` },
  };
}

function loadImages() {
  if (fs.existsSync(imagesPath)) return JSON.parse(fs.readFileSync(imagesPath, 'utf8'));
  // gen-4-image-turbo は参照画像が必須。テキストだけで作るときは gen-4（Gen-4 Image）か nano-banana-pro
  const obj = { id, model: 'gen-4', slots: defaultPrompts() };
  fs.writeFileSync(imagesPath, JSON.stringify(obj, null, 2), 'utf8');
  console.log(`作成: ${path.relative(process.cwd(), imagesPath)}（プロンプトは編集できます）`);
  return obj;
}
function fileFor(slot) {
  for (const ext of ['jpg', 'jpeg', 'png', 'webp']) { const f = path.join(imgDir, `${slot}.${ext}`); if (fs.existsSync(f)) return f; }
  return '';
}

if (mode === 'prompts') {
  const im = loadImages();
  for (const s of SLOTS) { const p = im.slots[s]; console.log(`\n[${s}] ${fileFor(s) ? '✔ 生成済み' : '— 未生成'} (${p?.ratio || '-'})\n${p?.prompt || '(なし)'}`); }
  console.log(`\n次: node auto-sales-agent/scripts/images.js ${id} runway  → 生成後に  node auto-sales-agent/scripts/images.js ${id} apply`);
  process.exit(0);
}

if (mode === 'runway') {
  const im = loadImages();
  fs.mkdirSync(imgDir, { recursive: true });
  const todo = SLOTS.filter((s) => im.slots[s] && !fileFor(s));
  if (!todo.length) { console.log('未生成のスロットはありません'); process.exit(0); }
  const outDir = imgDir.replace(/\\/g, '/');
  const list = todo.map((s) => `- slot "${s}": ratio ${im.slots[s].ratio}, save as ${outDir}/${s}.jpg\n  prompt: ${im.slots[s].prompt}`).join('\n');
  const prompt = `You are generating landing-page photos with the 'runway' MCP server.
First call show_plans_and_credits. If total remaining credits is 0, print exactly "NO_CREDITS" and stop without calling any generation tool.
Otherwise, for each slot below call generate_image with model "${im.model}" and the given ratio, poll get_task until it succeeds, then download the output with Bash curl -L -o to the given path. Do not generate anything else and do not retry a slot more than once.
${list}
When finished print one line per slot: "<slot>: ok <path>" or "<slot>: failed <reason>", then one line "CREDITS_LEFT: <n>".`;
  console.log(`Runway で ${todo.length} 枚を生成します（claude -p を起動）…`);
  // shell:true のため、空白を含む引数は自分で引用符で囲む（囲まないと "Bash(curl" と "*)" に割れる）
  const r = spawnSync('claude', ['-p', '--model', 'sonnet', '--allowedTools', '"mcp__runway__*,Bash(curl *)"'], { input: prompt, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 1024 * 1024 * 8 });
  const out = (r.stdout || '') + (r.stderr || '');
  console.log(out.trim());
  if (/NO_CREDITS/.test(out)) { console.error('\nRunway のクレジットが 0 のため生成していません。https://app.runwayml.com/settings/billing でプランまたはクレジットを追加してから再実行してください。'); process.exit(2); }
  const done = SLOTS.filter((s) => fileFor(s)).length;
  console.log(`\n生成済み ${done}/${SLOTS.length}。次: node auto-sales-agent/scripts/images.js ${id} apply`);
  process.exit(0);
}

if (mode === 'apply') {
  const dist = path.join(ROOT, 'dist', id);
  const target = path.join(dist, 'img');
  const images = { hero: '', benefits: ['', '', ''], reasons: ['', '', ''], closing: '' };
  let n = 0;
  for (const s of SLOTS) {
    const f = fileFor(s); if (!f) continue;
    fs.mkdirSync(target, { recursive: true });
    const name = `${s}${path.extname(f).toLowerCase()}`;
    fs.copyFileSync(f, path.join(target, name));
    const rel = `img/${name}`;
    const m = /^(benefits|reasons)-(\d)$/.exec(s);
    if (m) images[m[1]][Number(m[2])] = rel; else images[s] = rel;
    n++;
  }
  brief.drm = brief.drm || {};
  brief.drm.images = images;
  fs.writeFileSync(briefPath, JSON.stringify(brief, null, 2), 'utf8');
  console.log(`画像 ${n} 枚を brief.drm.images に反映しました`);
  const g = spawnSync(process.execPath, [path.join(__dirname, 'generate.js'), id], { stdio: 'inherit' });
  process.exit(g.status || 0);
}

console.error(`未対応のモード: ${mode}（prompts / runway / apply）`);
process.exit(1);
