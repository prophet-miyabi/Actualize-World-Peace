'use client';
import { useState } from 'react';

// アプリ自体の装飾画像（管理画面でAI生成したもの）を表示する。
// まだ生成されていない場合は何も表示せず、既存の背景（グラデーション等）だけが見える状態に戻す。
export default function SiteAssetImage({ assetKey, alt = '', className }: { assetKey: string; alt?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/api/site-assets/${assetKey}`} alt={alt} className={className} onError={() => setFailed(true)} />
  );
}
