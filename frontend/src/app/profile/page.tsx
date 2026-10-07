'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import api from '@/lib/api';

type LinkItem = { label: string; url: string };

const CATEGORIES = [
  { id: 'business', label: 'ビジネス' },
  { id: 'creator', label: 'クリエイター' },
  { id: 'other', label: 'その他' }
];

// プロフィールの設定。ユーザー名を決めると「AWPのURL/ユーザー名」があなたのページになる
export default function ProfileSettingsPage() {
  const [loaded, setLoaded] = useState(false);
  const [username, setUsername] = useState('');
  const [savedUsername, setSavedUsername] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [category, setCategory] = useState('');
  const [region, setRegion] = useState('');
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get('/community/me/profile').then(({ data }) => {
      const p = data.profile;
      setUsername(p.username || '');
      setSavedUsername(p.username);
      setName(p.name || '');
      setBio(p.bio || '');
      setCategory(p.category || '');
      setRegion(p.region || '');
      setLinks(Array.isArray(p.links) ? p.links : []);
      setLoaded(true);
    }).catch(() => {});
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const { data } = await api.put('/community/me/profile', {
        username, name, bio, category, region, links: links.filter((l) => l.url.trim())
      });
      setSavedUsername(data.profile.username);
      setLinks(data.profile.links || []);
      setSaved(true);
    } catch (err: any) {
      setError(err?.response?.data?.error || '保存できませんでした');
    } finally {
      setSaving(false);
    }
  };

  const updateLink = (i: number, key: keyof LinkItem, value: string) =>
    setLinks((all) => all.map((l, j) => (j === i ? { ...l, [key]: value } : l)));

  if (!loaded) return <main className="p-6 text-sm text-gray-400">読み込み中…</main>;

  const usernameValid = /^[a-z0-9-]{3,30}$/.test(username);

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-xl mx-auto px-4 py-6">
        <Link href="/dashboard" className="text-sm text-violet-700 font-bold">← ホーム</Link>
        <h1 className="text-2xl font-black mt-2">プロフィール</h1>
        <p className="text-sm text-gray-600 mt-1">あなたのページたちをまとめる名刺みたいな場所。フォローしてもらうとファンとつながれるよ。</p>

        {savedUsername && (
          <Link href={`/${savedUsername}`} className="mt-4 block rounded-2xl bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 text-white p-4">
            <span className="block text-xs opacity-90">公開中のプロフィール</span>
            <span className="block font-bold truncate">/{savedUsername} を見る →</span>
          </Link>
        )}

        <form onSubmit={save} className="mt-5 space-y-5">
          <label className="block">
            <span className="text-sm font-bold">ユーザー名</span>
            <div className="mt-1 flex items-center rounded-xl border bg-white px-3 focus-within:ring-2 focus-within:ring-violet-300">
              <span className="text-gray-400 text-sm">/</span>
              <input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} maxLength={30} autoCapitalize="none" autoCorrect="off"
                placeholder="your-name" className="flex-1 py-3 pl-1 text-base outline-none bg-transparent" />
            </div>
            <span className={`block text-xs mt-1 ${username && !usernameValid ? 'text-red-600' : 'text-gray-500'}`}>半角の英小文字・数字・ハイフンで3〜30文字</span>
          </label>

          <label className="block">
            <span className="text-sm font-bold">表示名</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required
              className="mt-1 w-full rounded-xl border bg-white px-3 py-3 text-base" />
          </label>

          <label className="block">
            <span className="text-sm font-bold">自己紹介</span>
            <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={300} rows={4}
              placeholder="どんな活動をしているか、ひとことで" className="mt-1 w-full rounded-xl border bg-white px-3 py-3 text-base" />
            <span className="block text-xs text-gray-400 text-right">{bio.length}/300</span>
          </label>

          <div>
            <span className="text-sm font-bold">ジャンル</span>
            <div className="mt-1 flex gap-2">
              {CATEGORIES.map((c) => (
                <button type="button" key={c.id} onClick={() => setCategory(category === c.id ? '' : c.id)}
                  className={`rounded-full px-4 py-2 text-sm font-bold ${category === c.id ? 'bg-violet-600 text-white' : 'bg-white border text-gray-600'}`}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="text-sm font-bold">活動地域（任意）</span>
            <input value={region} onChange={(e) => setRegion(e.target.value)} maxLength={30} placeholder="例: 東京・渋谷"
              className="mt-1 w-full rounded-xl border bg-white px-3 py-3 text-base" />
          </label>

          <div>
            <span className="text-sm font-bold">リンク（SNSやショップなど・最大10件）</span>
            <div className="mt-1 space-y-2">
              {links.map((l, i) => (
                <div key={i} className="bg-white border rounded-xl p-3 space-y-2">
                  <input value={l.label} onChange={(e) => updateLink(i, 'label', e.target.value)} maxLength={30} placeholder="表示名（例: Instagram）"
                    className="w-full rounded-lg border px-3 py-2 text-base" />
                  <input value={l.url} onChange={(e) => updateLink(i, 'url', e.target.value)} type="url" inputMode="url" placeholder="https://"
                    className="w-full rounded-lg border px-3 py-2 text-base" />
                  <button type="button" onClick={() => setLinks((all) => all.filter((_, j) => j !== i))} className="text-xs text-gray-500 underline">削除</button>
                </div>
              ))}
              {links.length < 10 && (
                <button type="button" onClick={() => setLinks((all) => [...all, { label: '', url: '' }])}
                  className="w-full rounded-xl border-2 border-dashed border-gray-300 py-3 text-sm font-bold text-gray-500">＋ リンクを追加</button>
              )}
            </div>
            <span className="block text-xs text-gray-500 mt-1">https:// から始まるURLだけ表示されます</span>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {saved && <p className="text-sm text-green-700 font-bold">保存しました 🎉</p>}
          <button disabled={saving || !usernameValid || !name.trim()}
            className="w-full rounded-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 text-white font-bold py-3.5 disabled:opacity-40">
            {saving ? '保存中…' : '保存する'}
          </button>
          <p className="text-xs text-gray-500">
            プロフィールは誰でも見られる公開情報です。電話番号やメールアドレスは表示されません。投稿内容は<Link href="/terms" className="underline">利用規約</Link>に従ってください。
          </p>
        </form>
      </div>
    </main>
  );
}
