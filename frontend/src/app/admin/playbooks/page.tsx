'use client';
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';
import AiHealthBanner from '@/components/admin/AiHealthBanner';

type Playbook = {
  summary: string; audience: string; decisionFactors: string[]; sectionOrder: string[];
  recommendedFeatures: { id: string; reason: string }[];
  hero: { eyebrowGuide: string; headlineGuide: string; subcopyGuide: string; ctaLabel: string; secondaryCtaLabel: string };
  tone: string; trustElements: string[]; writingRules: string[]; mustAvoid: string[];
  visual: { mood: string; imagery: string; primary: string; background: string; font: string; corner: string; heroLayout: string; strengthsStyle: string };
  conversationHints: string[]; references: { name: string; url: string; note: string }[];
  source: 'web' | 'model' | 'fallback';
};
type Item = { key: string; label: string; status: string; error: string | null; updatedAt: string | null; stale: boolean; source: string | null; pages: number; playbook: Playbook | null };

const STATUS: Record<string, string> = { ready: '作成済み', generating: '作成中', failed: '失敗', missing: '未作成' };
const SOURCE: Record<string, string> = { web: 'Web検索で調査', model: '知識のみ', fallback: '一般的な型' };

// 業種別「人気ページの手本」。ユーザーのページ作成（デザイン・文章・対話）の指示に使われる。
// 同業種の評価の高いサイトを Claude が調べて型をまとめたもので、約60日で作り直す
export default function PlaybooksPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [webSearch, setWebSearch] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data } = await api.get('/ops/playbooks');
    setItems(data.items);
    setWebSearch(data.webSearch);
  }, []);
  useEffect(() => { load().catch(() => setError('読み込みに失敗しました。')); }, [load]);
  // 作成中のものがあれば数秒ごとに更新
  useEffect(() => {
    if (!items?.some((i) => i.status === 'generating')) return;
    const t = setInterval(() => load().catch(() => {}), 6000);
    return () => clearInterval(t);
  }, [items, load]);

  const rebuild = async (key: string) => {
    setError(''); setMsg('');
    try {
      await api.post(`/ops/playbooks/${key}/rebuild`);
      setMsg('作り直しを始めました。数十秒かかります。');
      await load();
    } catch (e: any) { setError(e?.response?.data?.error ?? '開始できませんでした。'); }
  };
  const rebuildAll = async (onlyMissing: boolean) => {
    setError(''); setMsg('');
    try {
      const { data } = await api.post('/ops/playbooks/rebuild-all', { onlyMissing });
      setMsg(`${data.count}業種の作成を始めました。順番に進みます（1業種あたり数十秒）。`);
      await load();
    } catch (e: any) { setError(e?.response?.data?.error ?? '開始できませんでした。'); }
  };

  const ready = items?.filter((i) => i.status === 'ready').length ?? 0;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <AiHealthBanner />
      <h1 className="text-2xl font-bold">業種別の手本（人気ページの型）</h1>
      <p className="text-sm text-gray-600 mt-2 leading-relaxed">
        ユーザーがページを作るとき、AWPは同業種で評価の高いページの「型」（構成・見出しの作り方・信頼要素・ボタン文言・配色・写真の傾向）を手本にします。
        手本は業種ごとに1回作れば全ユーザーで共有され、約60日で作り直されます。他社の文章や数字は手本に含めません。
      </p>
      <div className="flex flex-wrap items-center gap-3 mt-4 text-sm">
        <span className="px-3 py-1 rounded-full bg-gray-100">{ready} / {items?.length ?? 0} 業種が作成済み</span>
        <span className={`px-3 py-1 rounded-full ${webSearch ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>{webSearch ? 'Web検索: 有効' : 'Web検索: 無効（PLAYBOOK_WEB_SEARCH=false）'}</span>
        <button type="button" onClick={() => rebuildAll(true)} className="px-4 py-1.5 rounded-full bg-blue-600 text-white font-bold">未作成・古いものを作る</button>
        <button type="button" onClick={() => rebuildAll(false)} className="px-4 py-1.5 rounded-full border font-bold">すべて作り直す</button>
      </div>
      {msg && <p className="text-green-700 text-sm mt-3">{msg}</p>}
      {error && <p className="text-red-600 text-sm mt-3">{error}</p>}

      <div className="mt-6 space-y-2">
        {!items && <p className="text-gray-500">読み込み中...</p>}
        {items?.map((it) => (
          <div key={it.key} className="bg-white border rounded-xl">
            <button type="button" onClick={() => setOpen(open === it.key ? null : it.key)} className="w-full text-left p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold">{it.label} <span className="text-xs text-gray-400 font-mono ml-1">{it.key}</span></p>
                <p className="text-xs text-gray-500 mt-1">
                  {it.pages > 0 ? `${it.pages}ページがこの業種` : 'まだこの業種のページはありません'}
                  {it.updatedAt && ` ・ 更新 ${new Date(it.updatedAt).toLocaleString('ja-JP')}`}
                  {it.source && ` ・ ${SOURCE[it.source] ?? it.source}`}
                  {it.playbook?.references?.length ? ` ・ 参照 ${it.playbook.references.length}件` : ''}
                </p>
                {it.error && <p className="text-xs text-red-600 mt-1">{it.error}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${it.status === 'ready' ? (it.stale ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-700') : it.status === 'generating' ? 'bg-blue-100 text-blue-700 animate-pulse' : it.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                  {it.status === 'ready' && it.stale ? '古い' : STATUS[it.status] ?? it.status}
                </span>
                <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); if (it.status !== 'generating') rebuild(it.key); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); rebuild(it.key); } }}
                  className={`text-xs font-bold underline ${it.status === 'generating' ? 'text-gray-400' : 'text-blue-600'}`}>
                  {it.status === 'missing' ? '作る' : '作り直す'}
                </span>
              </div>
            </button>
            {open === it.key && it.playbook && <PlaybookDetail pb={it.playbook} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-bold text-gray-500 tracking-wider mb-1">{title}</p>
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}
const List = ({ xs }: { xs: string[] }) => <ul className="list-disc pl-5 space-y-0.5">{xs.map((x, i) => <li key={i}>{x}</li>)}</ul>;

function PlaybookDetail({ pb }: { pb: Playbook }) {
  return (
    <div className="border-t p-4 grid md:grid-cols-2 gap-5">
      <Block title="お客様の見方">{pb.summary}<p className="text-gray-600 mt-1">{pb.audience}</p></Block>
      <Block title="決め手"><List xs={pb.decisionFactors} /></Block>
      <Block title="構成の並び"><p className="font-mono text-xs break-all">{pb.sectionOrder.join(' → ')}</p></Block>
      <Block title="おすすめの機能"><ul className="space-y-1">{pb.recommendedFeatures.map((f, i) => <li key={f.id}><span className="font-bold">{i + 1}. {f.id}</span> — {f.reason}</li>)}</ul></Block>
      <Block title="ファーストビュー">
        <p>上の一行: {pb.hero.eyebrowGuide}</p>
        <p>見出し: {pb.hero.headlineGuide}</p>
        <p>補足: {pb.hero.subcopyGuide}</p>
        <p>ボタン: 「{pb.hero.ctaLabel}」 / 「{pb.hero.secondaryCtaLabel}」</p>
      </Block>
      <Block title="見た目">
        <p>{pb.visual.mood}</p>
        <p className="flex items-center gap-2 mt-1">
          <span className="inline-block w-5 h-5 rounded border" style={{ background: pb.visual.primary }} /> {pb.visual.primary}
          <span className="inline-block w-5 h-5 rounded border ml-2" style={{ background: pb.visual.background }} /> {pb.visual.background}
          <span className="text-xs text-gray-500 ml-2">{pb.visual.font} / {pb.visual.corner} / {pb.visual.heroLayout} / {pb.visual.strengthsStyle}</span>
        </p>
        <p className="text-xs text-gray-500 mt-1">{pb.visual.imagery}</p>
      </Block>
      <Block title="トーンと書き方"><p>{pb.tone}</p><List xs={pb.writingRules} /></Block>
      <Block title="信頼の要素"><List xs={pb.trustElements} /></Block>
      <Block title="避けること"><List xs={pb.mustAvoid} /></Block>
      <Block title="対話で聞くこと"><List xs={pb.conversationHints} /></Block>
      <div className="md:col-span-2">
        <Block title={`参照した実在ページ（${pb.references.length}件・運営者の確認用）`}>
          {pb.references.length === 0 ? <p className="text-gray-500">なし</p> : (
            <ul className="space-y-1">
              {pb.references.map((r, i) => (
                <li key={i}><a href={r.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">{r.name}</a> <span className="text-gray-600">— {r.note}</span></li>
              ))}
            </ul>
          )}
        </Block>
      </div>
    </div>
  );
}
