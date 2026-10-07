'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';

// プロフィールのフォローボタン。ログイン情報は端末（localStorage）にあるため、状態は画面側で取り直す
export default function FollowButton({ username, initialFollowers }: { username: string; initialFollowers: number }) {
  const [followers, setFollowers] = useState(initialFollowers);
  const [following, setFollowing] = useState(false);
  const [isMe, setIsMe] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);

  const token = () => {
    try { return localStorage.getItem('token') || ''; } catch { return ''; }
  };

  useEffect(() => {
    const t = token();
    setSignedIn(!!t);
    if (!t) return;
    fetch(`/api/community/profiles/${username}`, { headers: { Authorization: `Bearer ${t}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setFollowing(d.isFollowing); setIsMe(d.isMe); setFollowers(d.profile.followers); } })
      .catch(() => {});
  }, [username]);

  const toggle = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/community/follow/${username}`, { method: following ? 'DELETE' : 'POST', headers: { Authorization: `Bearer ${token()}` } });
      if (!r.ok) return;
      const d = await r.json();
      setFollowing(d.following);
      setFollowers(d.followers);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <p className="text-sm"><span className="font-black">{followers}</span> <span className="text-gray-500">フォロワー</span></p>
      {isMe ? (
        <Link href="/profile" className="ml-auto rounded-full border border-gray-300 px-5 py-2 text-sm font-bold">プロフィールを編集</Link>
      ) : signedIn ? (
        <button onClick={toggle} disabled={busy}
          className={`ml-auto rounded-full px-6 py-2 text-sm font-bold ${following ? 'border border-gray-300 text-gray-700' : 'bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 text-white'}`}>
          {following ? 'フォロー中' : 'フォローする'}
        </button>
      ) : (
        <Link href="/login" className="ml-auto rounded-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 text-white px-6 py-2 text-sm font-bold">フォローする</Link>
      )}
    </div>
  );
}
