'use client';
import { useEffect, useState } from 'react';
import ReportButton from './ReportButton';

// 公開ページの下に出す小さなバー: いいね・作った人のプロフィール・通報。
// 表示時に閲覧を1回記録する（流入元はドメイン名だけ送り、訪問者を特定する情報は送らない）
type Props = { slug: string; owner: { username: string; name: string } | null; siteUrl: string };

function token() {
  try { return localStorage.getItem('token') || ''; } catch { return ''; }
}

export default function PageEngagementBar({ slug, owner, siteUrl }: Props) {
  const [likes, setLikes] = useState<number | null>(null);
  const [liked, setLiked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [needLogin, setNeedLogin] = useState(false);

  useEffect(() => {
    const t = token();
    fetch(`/api/community/likes/${slug}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setLikes(d.count); setLiked(d.liked); } })
      .catch(() => {});
    let ref = '';
    try {
      if (document.referrer && new URL(document.referrer).host !== location.host) ref = new URL(document.referrer).origin;
    } catch { /* 無視 */ }
    fetch('/api/community/events', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ type: 'view', slug, ref })
    }).catch(() => {});
  }, [slug]);

  const toggleLike = async () => {
    const t = token();
    if (!t) { setNeedLogin(true); return; }
    setBusy(true);
    try {
      const r = await fetch(`/api/community/likes/${slug}`, { method: liked ? 'DELETE' : 'POST', headers: { Authorization: `Bearer ${t}` } });
      if (r.status === 401) { setNeedLogin(true); return; }
      if (!r.ok) return;
      const d = await r.json();
      setLiked(d.liked);
      setLikes(d.count);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white text-gray-800 border-t border-gray-200 px-4 py-4" style={{ fontFamily: 'var(--font-sans-jp)' }}>
      <div className="max-w-3xl mx-auto flex items-center gap-3">
        <button onClick={toggleLike} disabled={busy} aria-pressed={liked} aria-label="いいね"
          className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold border transition ${liked ? 'bg-pink-50 border-pink-300 text-pink-600' : 'border-gray-200 text-gray-600'}`}>
          <span aria-hidden>{liked ? '♥' : '♡'}</span>
          {likes ?? ''}
        </button>
        {owner ? (
          <a href={`${siteUrl}/${owner.username}`} className="min-w-0 flex-1 text-sm">
            <span className="block text-[11px] text-gray-500">このページを作った人</span>
            <span className="block font-bold truncate">{owner.name} <span className="text-gray-400 font-normal">@{owner.username}</span></span>
          </a>
        ) : <span className="flex-1" />}
        <ReportButton targetType="page" targetId={slug} />
      </div>
      {needLogin && (
        <p className="max-w-3xl mx-auto mt-2 text-xs text-violet-700">
          いいねするには <a href={`${siteUrl}/login`} className="underline font-bold">ログイン</a> してね
        </p>
      )}
      <p className="max-w-3xl mx-auto mt-3 text-[11px] text-gray-400">
        Made with <a href={siteUrl} className="underline">AWP</a>
      </p>
    </div>
  );
}
