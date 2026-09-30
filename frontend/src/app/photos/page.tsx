'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import api from '@/lib/api';

type Photo = { id: string; isLogo: boolean; position: number; originalType: string; enhanceStatus: string | null; createdAt: string };

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// 画像本体はJWT認証つきのAPIから取得するため、素の<img src>では読み込めない
// （Authorizationヘッダーを付けられないため）。fetchしてBlob URLに変換して表示する
function PhotoThumbnail({ id }: { id: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    api.get(`/photos/${id}/image`, { responseType: 'blob' }).then((res) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(res.data);
      setSrc(objectUrl);
    }).catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);

  if (!src) return <div className="w-full aspect-square bg-gray-100 animate-pulse" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className="w-full aspect-square object-cover" />;
}

function PhotosInner() {
  const searchParams = useSearchParams();
  const lpId = searchParams.get('lp') || '';
  const withLp = (params: Record<string, string> = {}) => (lpId ? { ...params, lpId } : params);

  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data } = await api.get('/photos', { params: withLp() });
    setPhotos(data.photos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lpId]);

  useEffect(() => { load().catch(() => setError('読み込みに失敗しました。')); }, [load]);

  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('JPEG・PNG・WebPのみアップロードできます。');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('読み込みに失敗しました'));
        reader.readAsDataURL(file);
      });
      await api.post('/photos', { ...withLp(), dataUrl });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'アップロードに失敗しました。');
    } finally {
      setUploading(false);
    }
  };

  const setAsLogo = async (id: string) => {
    setBusyId(id);
    try {
      await api.put(`/photos/${id}`, { ...withLp(), isLogo: true });
      await load();
    } catch {
      setError('更新に失敗しました。');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('この写真を削除しますか？')) return;
    setBusyId(id);
    try {
      await api.delete(`/photos/${id}`, { params: withLp() });
      await load();
    } catch {
      setError('削除に失敗しました。');
    } finally {
      setBusyId(null);
    }
  };

  if (!photos) return <p className="p-8">{error || '読み込み中...'}</p>;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <Link href="/dashboard" className="text-sm text-gray-500">← ダッシュボードへ戻る</Link>
        <h1 className="text-2xl font-bold mt-2 mb-1">写真・ロゴ</h1>
        <p className="text-sm text-gray-500 mb-6">
          お店・事業の実際の写真やロゴをアップロードして管理できます（最大20枚、1枚8MBまで）。
        </p>
        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

        <label className={`inline-block px-5 py-2 rounded-lg font-bold text-sm mb-6 ${uploading ? 'bg-gray-200 text-gray-400' : 'bg-blue-600 text-white cursor-pointer'}`}>
          {uploading ? 'アップロード中...' : '写真を追加する'}
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onFileSelected} disabled={uploading} className="hidden" />
        </label>

        {photos.length === 0 ? (
          <p className="text-gray-400 text-sm">まだ写真がありません。</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {photos.map((p) => (
              <div key={p.id} className="bg-white border rounded-xl overflow-hidden">
                <PhotoThumbnail id={p.id} />
                <div className="p-3">
                  {p.isLogo && <span className="text-xs font-bold text-blue-700 bg-blue-50 rounded-full px-2 py-0.5">ロゴ</span>}
                  <div className="flex gap-3 mt-2">
                    {!p.isLogo && (
                      <button onClick={() => setAsLogo(p.id)} disabled={busyId === p.id} className="text-xs font-bold text-blue-600 disabled:opacity-50">
                        ロゴにする
                      </button>
                    )}
                    <button onClick={() => remove(p.id)} disabled={busyId === p.id} className="text-xs font-bold text-gray-400 disabled:opacity-50">
                      削除
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Photos() {
  return (
    <Suspense fallback={<p className="p-8">読み込み中...</p>}>
      <PhotosInner />
    </Suspense>
  );
}
