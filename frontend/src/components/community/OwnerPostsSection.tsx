'use client';
import { useEffect, useState } from 'react';
import type { PostView } from './PostCard';
import type { Design } from '@/components/lp/LandingView';

// 公開ページ（HP/LP）に組み込む「最新の投稿」。持ち主がSNSに投稿するたびに自動で更新される。
// ページのデザイン（配色・書体・角丸）に合わせて描くので、ページの一部として見える。
// 持ち主は投稿ごとに「ページに非表示」にでき、ページ側では載せる位置と載せるかどうかを選べる。
// 構成: リール（縦動画）の横スクロール → 写真の格子 → 文章の投稿
export type PostsConfig = { count?: number; kinds?: string[]; layout?: 'grid' | 'list'; title?: string };

export default function OwnerPostsSection({ username, ownerName, design, siteUrl, config }: { username: string; ownerName?: string; design: Design; siteUrl: string; config?: PostsConfig | null }) {
  const [posts, setPosts] = useState<PostView[] | null>(null);
  const count = Math.min(12, Math.max(3, config?.count ?? 12));
  const kinds = config?.kinds?.length ? config.kinds : ['post', 'reel'];
  const layout = config?.layout ?? 'grid';
  useEffect(() => {
    fetch(`/api/posts/user/${encodeURIComponent(username)}?limit=${count}&onPage=1`).then((r) => r.json()).then((d) => setPosts(d.posts || [])).catch(() => setPosts([]));
  }, [username, count]);
  if (!posts || posts.length === 0) return null;

  const p = design.palette;
  const radius = design.corner === 'sharp' ? 6 : design.corner === 'round' ? 22 : 14;
  const pill = design.corner === 'sharp' ? 6 : 9999;
  const headingFont = design.font === 'elegant' ? 'var(--font-serif-jp)' : design.font === 'friendly' ? 'var(--font-rounded-jp)' : 'var(--font-sans-jp)';
  const hex = (h: string, a: number) => { const n = parseInt(h.slice(1), 16); return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`; };
  const muted = hex(p.text, 0.65);

  // リール: 動画本体を持つもの、または外部SNSから取り込んだ縦動画（サムネイル＋元URL）
  const isReel = (x: PostView) => !!x.video || (x.kind === 'reel' && !!x.externalUrl);
  const reels = kinds.includes('reel') ? posts.filter(isReel) : [];
  const photos = kinds.includes('post') ? posts.filter((x) => !isReel(x) && x.image) : [];
  const texts = kinds.includes('post') ? posts.filter((x) => !isReel(x) && !x.image && x.body) : [];
  if (reels.length + photos.length + texts.length === 0) return null;
  const profile = `${siteUrl}/${username}`;
  const title = config?.title?.trim() || '最新の投稿';

  return (
    <section id="posts" data-awp-posts className="px-5 sm:px-6 py-14 sm:py-20" style={{ background: hex(p.primary, 0.05), scrollMarginTop: 72 }}>
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-8 sm:mb-10">
          <p style={{ color: p.primary }} className="text-[11px] font-bold tracking-[0.3em] mb-3">POSTS</p>
          <h2 style={{ fontFamily: headingFont, fontWeight: 700, color: p.text }} className="text-[1.45rem] sm:text-3xl leading-snug">{title}</h2>
          <span aria-hidden style={{ background: p.primary }} className="block w-10 h-1 mx-auto mt-4 rounded-full" />
          <p className="text-sm mt-3" style={{ color: muted }}>{ownerName ? `${ownerName}の` : ''}新作・お知らせ・日々のこと。投稿すると、ここに自動で届きます。</p>
        </div>

        {reels.length > 0 && (
          <div className="-mx-5 sm:mx-0 px-5 sm:px-0 mb-6 flex gap-3 overflow-x-auto snap-x snap-mandatory [scrollbar-width:none]">
            {reels.slice(0, 8).map((x) => (
              <a key={x.id} href={x.video ? `${siteUrl}/p/${x.id}` : (x.externalUrl ?? `${siteUrl}/p/${x.id}`)} target={x.video ? undefined : '_blank'} rel={x.video ? undefined : 'noopener noreferrer'}
                className="relative shrink-0 w-[42vw] sm:w-44 aspect-[9/16] overflow-hidden bg-black snap-start shadow-md" style={{ borderRadius: radius }}>
                {x.video ? (
                  /* サムネイルが無いので、読み込み後に最初のコマへ進めて1枚目を表示する（真っ黒・無地のまま止まらないように） */
                  <video src={x.video} muted playsInline preload="metadata" className="w-full h-full object-cover"
                    onLoadedMetadata={(e) => { try { e.currentTarget.currentTime = 0.1; } catch { /* 無視 */ } }} />
                ) : x.image ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={x.image} alt="" loading="lazy" className="w-full h-full object-cover" />
                ) : <div className="w-full h-full" style={{ background: p.primary }} />}
                <span className="absolute inset-x-0 bottom-0 p-2 text-[11px] text-white leading-snug line-clamp-2" style={{ background: 'linear-gradient(180deg, transparent, rgba(0,0,0,0.65))' }}>{x.body}</span>
                <span className="absolute top-2 right-2 text-[10px] font-bold bg-white/90 text-black rounded-full px-1.5 py-0.5">▶ {x.source && x.source !== 'awp' ? x.source : 'リール'}</span>
              </a>
            ))}
          </div>
        )}

        {photos.length > 0 && (
          layout === 'list' ? (
            /* リスト: 写真と文章を横並びで、SNSのタイムラインのように */
            <ul className="space-y-3 mb-6 max-w-2xl mx-auto">
              {photos.slice(0, count).map((x) => (
                <li key={x.id}>
                  <a href={`${siteUrl}/p/${x.id}`} className="flex gap-3 p-3 shadow-sm" style={{ background: p.surface, borderRadius: radius, border: `1px solid ${hex(p.text, 0.08)}` }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={x.image!} alt="" loading="lazy" className="w-24 h-24 sm:w-32 sm:h-32 object-cover shrink-0" style={{ borderRadius: radius / 2 }} />
                    <span className="min-w-0 text-sm leading-relaxed" style={{ color: p.text }}><span className="line-clamp-4 whitespace-pre-wrap">{x.body}</span><span className="block text-[11px] mt-1" style={{ color: muted }}>{new Date(x.createdAt).toLocaleDateString('ja-JP')}</span></span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
          <div className={`grid gap-2 mb-6 ${photos.length === 1 ? 'grid-cols-1 max-w-md mx-auto' : photos.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
            {photos.slice(0, Math.min(count, 9)).map((x) => (
              <a key={x.id} href={`${siteUrl}/p/${x.id}`} className="relative aspect-square overflow-hidden shadow-sm" style={{ borderRadius: radius, background: p.surface }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={x.image!} alt="" loading="lazy" className="w-full h-full object-cover" />
              </a>
            ))}
          </div>
          )
        )}

        {texts.length > 0 && (
          <ul className="grid sm:grid-cols-2 gap-3">
            {texts.slice(0, 4).map((x) => (
              <li key={x.id}>
                <a href={`${siteUrl}/p/${x.id}`} className="block h-full px-5 py-4 text-sm leading-relaxed shadow-sm" style={{ background: p.surface, color: p.text, borderRadius: radius, border: `1px solid ${hex(p.text, 0.08)}` }}>
                  <span className="line-clamp-4 whitespace-pre-wrap">{x.body}</span>
                  <span className="block text-[11px] mt-2" style={{ color: muted }}>{new Date(x.createdAt).toLocaleDateString('ja-JP')}</span>
                </a>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <a href={profile} className="inline-block text-center font-bold px-7 py-3.5 shadow-md" style={{ background: p.primary, color: p.onPrimary, borderRadius: pill }}>フォローして最新を受け取る</a>
          <a href={profile} className="inline-block text-center font-bold px-7 py-3.5" style={{ color: p.text, border: `1.5px solid ${hex(p.text, 0.22)}`, borderRadius: pill }}>投稿をすべて見る</a>
        </div>
      </div>
    </section>
  );
}
