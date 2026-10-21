#!/usr/bin/env node
// 案件スカウト: クラウドワークス・ランサーズの新着一覧を読み、条件に合う案件だけを input/queue/<案件ID>/ に保存する。
//   node auto-sales-agent/scripts/scout.js            # 設定どおりに巡回
//   node auto-sales-agent/scripts/scout.js --dry      # 保存せずに候補を表示
// 仕組み:
//   - クラウドワークス: 一覧ページに埋め込まれた検索結果JSON（<div id="vue-container" data=...>）を読む（RSSは無い）
//   - ランサーズ: 一覧HTMLのカード（p-search-job-media）を読む
//   - 条件（予算・文脈・新着・提案数）で絞り、詳細ページから本文を取り、queue に job_post.txt / meta.json を置く
//   - 既に見た案件は input/queue/seen.json で除外
// 守ること: 取得間隔を空ける（request_interval_ms）、1回の実行で読む詳細は max_fetch_detail 件まで、robots.txt を尊重する。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const QUEUE = path.join(ROOT, 'input', 'queue');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'scout.config.json'), 'utf8'));
const dry = process.argv.includes('--dry');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 AWP-scout/1.0 (manual review; contact: miyabiawp7@gmail.com)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const unescapeHtml = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const stripTags = (s) => unescapeHtml(s.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<\/(p|div|li|h\d|tr|br|dd|dt)>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja,en;q=0.8' } });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return text;
}

// ---------- クラウドワークス ----------
function parseCrowdworks(html) {
  const m = /<div id="vue-container" data="([^"]*)"/.exec(html);
  if (!m) return [];
  const d = JSON.parse(unescapeHtml(m[1]));
  const jobs = d?.searchResult?.job_offers ?? [];
  return jobs.map((j) => {
    const o = j.job_offer || {};
    const fixed = j.payment?.fixed_price_payment;
    const hourly = j.payment?.hourly_payment;
    return {
      platform: 'crowdworks', id: `cw-${o.id}`, externalId: String(o.id), url: `https://crowdworks.jp/public/jobs/${o.id}`,
      title: o.title || '', digest: o.description_digest || '', categoryId: o.category_id,
      budgetMin: fixed?.min_budget ?? null, budgetMax: fixed?.max_budget ?? null, hourly: hourly ? (hourly.min_hourly_wage || hourly.max_hourly_wage || 0) : null,
      postedAt: o.last_released_at || null, expiresOn: o.expired_on || null,
      proposals: null, contracts: j.entry?.project_entry?.num_contracts ?? null, slots: j.entry?.project_entry?.project_contract_hope_number ?? null,
      client: j.client?.username || ''
    };
  });
}
async function crowdworksDetail(job) {
  const html = await get(job.url);
  const text = stripTags(html);
  const i = text.indexOf('仕事の詳細');
  let body = i >= 0 ? text.slice(i) : text;
  const cut = body.search(/この仕事の特徴|クライアント情報|最近応募したクラウドワーカー/);
  if (cut > 0) body = body.slice(0, cut);
  // 詳細ページの「応募した人 N 人」を提案数として使う（一覧には無い）
  const m = /応募した人\s*([\d,]+)\s*人/.exec(text);
  const applicants = m ? Number(m[1].replace(/,/g, '')) : null;
  return { body: body.trim(), proposals: applicants };
}

// ---------- ランサーズ ----------
function parseLancers(html) {
  const out = [];
  const re = /<div onclick="goToLjpWorkDetail\((\d+)\)" class="p-search-job-media c-media c-media--item[\s\S]*?(?=<div onclick="goToLjpWorkDetail\(|<\/section>|$)/g;
  let m;
  while ((m = re.exec(html))) {
    const card = m[0];
    const id = m[1];
    const title = stripTags((/<a class="p-search-job-media__title c-media__title"[^>]*>([\s\S]*?)<\/a>/.exec(card) || [])[1] || '').replace(/^NEW\s*/, '').trim();
    const nums = [...card.matchAll(/p-search-job-media__number">([\d,]+)</g)].map((x) => Number(x[1].replace(/,/g, '')));
    const priceBlock = (/p-search-job-media__price">([\s\S]*?)<\/span>\s*<\/div>/.exec(card) || [])[1] || '';
    const isHourly = /時間/.test(stripTags(priceBlock));
    const priceNums = [...priceBlock.matchAll(/p-search-job-media__number">([\d,]+)</g)].map((x) => Number(x[1].replace(/,/g, '')));
    const worktype = stripTags((/c-badge__text">([^<]*)</.exec(card) || [])[1] || '');
    const desc = stripTags((/c-media__description js-job-show-description">([\s\S]*?)<\/div>/.exec(card) || [])[1] || '');
    const isNew = /p-search-job-media__tag--new/.test(card);
    const winners = Number(((/当選者数[\s\S]*?propose-number[^>]*>(\d+)</.exec(card) || [])[1]) ?? 0);
    const remaining = stripTags((/p-search-job-media__time-remaining">([^<]*)</.exec(card) || [])[1] || '');
    out.push({
      platform: 'lancers', id: `ln-${id}`, externalId: id, url: `https://www.lancers.jp/work/detail/${id}`,
      title, digest: desc, categoryId: null,
      budgetMin: isHourly ? null : (priceNums[0] ?? null), budgetMax: isHourly ? null : (priceNums[1] ?? priceNums[0] ?? null), hourly: isHourly ? (priceNums[0] ?? 0) : null,
      postedAt: null, isNew, remaining, worktype, proposals: null, contracts: winners, slots: nums.at(-1) ?? null, client: ''
    });
  }
  return out;
}
async function lancersDetail(job) {
  const html = await get(job.url);
  const text = stripTags(html);
  const start = text.search(/依頼の概要|仕事の概要|依頼内容|業務内容/);
  let body = start >= 0 ? text.slice(start) : text;
  const cut = body.search(/この依頼に関する|クライアント情報|提案した人|応募した人|よく似た仕事/);
  if (cut > 0) body = body.slice(0, cut);
  const proposals = Number((/提案数[\s\S]{0,40}?(\d+)/.exec(text) || [])[1] ?? NaN);
  return { body: body.trim().slice(0, 12000), proposals: Number.isNaN(proposals) ? null : proposals };
}

// ---------- 条件 ----------
const matchAny = (text, words) => words.filter((w) => text.includes(w));
function judge(job) {
  const text = `${job.title}\n${job.digest}`;
  const bad = matchAny(text, cfg.must_not_match);
  if (bad.length) return { ok: false, why: `除外語: ${bad.join('・')}` };
  const good = matchAny(text, cfg.must_match_any);
  if (!good.length) return { ok: false, why: '文脈に合わない' };
  if (job.worktype && /タスク|コンペ|求人/.test(job.worktype)) return { ok: false, why: `形式: ${job.worktype}` };
  const max = job.budgetMax ?? job.budgetMin;
  if (job.hourly != null && max == null) {
    if (!matchAny(text, cfg.hourly_ok_if_match).length) return { ok: false, why: '時給案件' };
  } else if (max == null) {
    if (!cfg.allow_budget_unknown) return { ok: false, why: '予算不明' };
  } else if (max < cfg.min_budget_jpy) return { ok: false, why: `予算 ${max.toLocaleString()} 円` };
  if (job.postedAt) {
    const age = (Date.now() - new Date(job.postedAt).getTime()) / 3600_000;
    if (age > cfg.max_age_hours) return { ok: false, why: `${Math.round(age)} 時間前の掲載` };
  } else if (job.platform === 'lancers' && !job.isNew) return { ok: false, why: '新着ではない' };
  if (job.contracts != null && job.slots != null && job.contracts >= job.slots) return { ok: false, why: '募集枠が埋まっている' };
  const score = (max ? Math.min(max, 1_000_000) / 100_000 : 2) + good.length * 1.5 + (job.isNew || job.postedAt ? 1 : 0);
  return { ok: true, why: `一致: ${good.join('・')}`, score };
}

// ---------- 実行 ----------
async function main() {
  fs.mkdirSync(QUEUE, { recursive: true });
  const seenPath = path.join(QUEUE, 'seen.json');
  const seen = fs.existsSync(seenPath) ? JSON.parse(fs.readFileSync(seenPath, 'utf8')) : {};
  const candidates = new Map();
  for (const src of cfg.sources) {
    try {
      const html = await get(src.url);
      const jobs = src.platform === 'crowdworks' ? parseCrowdworks(html) : parseLancers(html);
      let kept = 0;
      for (const j of jobs) {
        if (seen[j.id] || candidates.has(j.id)) continue;
        const v = judge(j);
        if (v.ok) { candidates.set(j.id, { ...j, score: v.score, why: v.why, source: src.label }); kept++; }
      }
      console.log(`${src.label}: ${jobs.length} 件 → 候補 ${kept} 件`);
    } catch (e) {
      console.warn(`${src.label}: 取得に失敗（${e.message}）`);
    }
    await sleep(cfg.request_interval_ms);
  }
  const ranked = [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, cfg.max_fetch_detail);
  const picked = [];
  for (const j of ranked) {
    try {
      await sleep(cfg.request_interval_ms);
      const detail = j.platform === 'crowdworks' ? await crowdworksDetail(j) : await lancersDetail(j);
      const proposals = detail.proposals ?? j.proposals;
      if (proposals != null && proposals > cfg.max_proposals) { seen[j.id] = { skipped: `提案 ${proposals}`, at: new Date().toISOString() }; console.log(`  × ${j.title.slice(0, 40)}（提案 ${proposals} 件）`); continue; }
      const bad = matchAny(detail.body, cfg.must_not_match);
      if (bad.length && !matchAny(detail.body, cfg.must_match_any).length) { seen[j.id] = { skipped: `本文: ${bad[0]}`, at: new Date().toISOString() }; continue; }
      picked.push({ ...j, proposals, body: detail.body });
      if (picked.length >= cfg.max_pick_per_run) break;
    } catch (e) {
      console.warn(`  詳細の取得に失敗: ${j.url}（${e.message}）`);
    }
  }
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  for (const j of picked) {
    const id = `${day}-${j.id}`;
    const budget = j.hourly != null && j.budgetMax == null ? `時給 ${j.hourly.toLocaleString()} 円` : j.budgetMax != null ? `${(j.budgetMin ?? j.budgetMax).toLocaleString()} 〜 ${j.budgetMax.toLocaleString()} 円` : '相談可（記載なし）';
    const post = [`【${j.platform === 'crowdworks' ? 'クラウドワークス' : 'ランサーズ'}】${j.title}`, `URL: ${j.url}`, `予算: ${budget}`, j.postedAt ? `掲載: ${j.postedAt}` : j.remaining ? `募集: ${j.remaining}` : '', j.proposals != null ? `提案数の目安: ${j.proposals}` : '', '', j.body].filter(Boolean).join('\n');
    console.log(`  ✓ ${id}  ${j.title.slice(0, 50)}  [${budget}] score ${j.score.toFixed(1)}  ${j.why}`);
    if (dry) continue;
    const dir = path.join(QUEUE, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'job_post.txt'), post, 'utf8');
    fs.writeFileSync(path.join(dir, 'job_url.txt'), j.url, 'utf8');
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ id, platform: j.platform, url: j.url, title: j.title, budgetMin: j.budgetMin, budgetMax: j.budgetMax, hourly: j.hourly, postedAt: j.postedAt, proposals: j.proposals, score: j.score, why: j.why, source: j.source, pickedAt: new Date().toISOString() }, null, 2), 'utf8');
    seen[j.id] = { queued: id, at: new Date().toISOString() };
  }
  if (!dry) fs.writeFileSync(seenPath, JSON.stringify(seen, null, 2), 'utf8');
  console.log(`\n候補 ${candidates.size} 件 → 保存 ${dry ? 0 : picked.length} 件（${QUEUE}）`);
}

main().catch((e) => { console.error(e); process.exit(1); });
