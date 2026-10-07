'use client';
import { useEffect, useRef, useState } from 'react';

// アプリ自体の装飾画像（管理画面でAI生成したもの）を表示する。
// まだ生成されていない場合は何も表示せず、既存の背景（グラデーション等）だけが見える状態に戻す。
export default function SiteAssetImage({ assetKey, alt = '', className }: { assetKey: string; alt?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // サーバー描画された<img>は、Reactが onError を付ける前に読み込みに失敗していることがある。
  // その場合はイベントが二度と来ないので、表示開始時に読み込み結果を直接確認する
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, []);

  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img ref={imgRef} src={`/api/site-assets/${assetKey}`} alt={alt} className={className} onError={() => setFailed(true)} />
  );
}
