import { recordAiCost } from '../lib/aiUsage';

// Runway（画像・動画生成）。REST API を直接呼ぶ（依存パッケージなし）。
//   docs: https://docs.dev.runwayml.com/  base: https://api.dev.runwayml.com/v1  header: X-Runway-Version: 2024-11-06
//   料金の目安（1クレジット = $0.01）: gen4_image_turbo 2cr/枚、gen4_image 5cr(720p)〜8cr(1080p)、
//   gemini_image3_pro 20cr/枚、gen4_turbo 5cr/秒、gen4.5 12cr/秒、seedance2 36cr/秒〜
// 生成物のURLは24時間で消えるため、必ずダウンロードして DB に保存する。
const BASE = 'https://api.dev.runwayml.com/v1';
const VERSION = '2024-11-06';

export const runwayConfigured = () => !!process.env.RUNWAYML_API_SECRET;
export const RUNWAY_IMAGE_MODEL = () => process.env.RUNWAY_IMAGE_MODEL || 'gen4_image';
export const RUNWAY_VIDEO_MODEL = () => process.env.RUNWAY_VIDEO_MODEL || 'gen4_turbo';

const IMAGE_COST_USD: Record<string, number> = { gen4_image_turbo: 0.02, gen4_image: 0.08, gemini_image3_pro: 0.2 };
const VIDEO_COST_PER_SEC_USD: Record<string, number> = { gen4_turbo: 0.05, 'gen4.5': 0.12, seedance2: 0.36, 'veo3.1': 0.4 };

function headers() {
  const key = process.env.RUNWAYML_API_SECRET;
  if (!key) throw new Error('RUNWAYML_API_SECRET が未設定です');
  return { Authorization: `Bearer ${key}`, 'X-Runway-Version': VERSION, 'Content-Type': 'application/json' };
}

async function createTask(path: string, body: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${BASE}/${path}`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  const d: any = await res.json().catch(() => ({}));
  if (!res.ok || !d?.id) throw new Error(`Runway ${path} に失敗 (${res.status}): ${d?.error || d?.message || JSON.stringify(d).slice(0, 200)}`);
  return String(d.id);
}

type Task = { id: string; status: 'PENDING' | 'THROTTLED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'; output?: string[]; failure?: string; failureCode?: string };

async function waitTask(id: string, timeoutMs: number): Promise<Task> {
  const started = Date.now();
  let wait = 3000;
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, wait));
    const res = await fetch(`${BASE}/tasks/${id}`, { headers: headers() });
    const t: Task = await res.json().catch(() => ({ id, status: 'RUNNING' } as Task));
    if (t.status === 'SUCCEEDED') return t;
    if (t.status === 'FAILED' || t.status === 'CANCELLED') throw new Error(`Runway の生成が失敗しました: ${t.failure || t.failureCode || t.status}`);
    wait = Math.min(wait * 1.3, 10_000);
  }
  throw new Error('Runway の生成が時間内に完了しませんでした');
}

async function download(url: string): Promise<{ data: Buffer; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`生成物のダウンロードに失敗 (${res.status})`);
  const mimeType = res.headers.get('content-type') || 'application/octet-stream';
  return { data: Buffer.from(await res.arrayBuffer()), mimeType: mimeType.split(';')[0] };
}

// gen4_image の比率（横長・縦長・正方形）。他モデルでも概ね通る値
const IMAGE_RATIOS = { landscape: '1920:1080', portrait: '1080:1920', square: '1024:1024', wide720: '1280:720' } as const;
const VIDEO_RATIOS = { landscape: '1280:720', portrait: '720:1280', square: '960:960' } as const;

export async function runwayImage(prompt: string, opts: { ratio?: keyof typeof IMAGE_RATIOS; model?: string } = {}): Promise<{ data: Buffer; mimeType: string }> {
  const model = opts.model || RUNWAY_IMAGE_MODEL();
  const id = await createTask('text_to_image', { model, promptText: prompt.slice(0, 1000), ratio: IMAGE_RATIOS[opts.ratio || 'landscape'] });
  const t = await waitTask(id, 3 * 60_000);
  const url = t.output?.[0];
  if (!url) throw new Error('Runway returned no image');
  void recordAiCost('runway-image', model, IMAGE_COST_USD[model] ?? 0.08);
  return download(url);
}

// 画像（データURI）から短い動画を作る（リール・ヒーロー動画用）。duration は 5 か 10 秒
export async function runwayVideo(image: { data: Buffer; mimeType: string }, prompt: string, opts: { ratio?: keyof typeof VIDEO_RATIOS; duration?: 5 | 10; model?: string } = {}): Promise<{ data: Buffer; mimeType: string; seconds: number }> {
  const model = opts.model || RUNWAY_VIDEO_MODEL();
  const duration = opts.duration ?? 5;
  const dataUri = `data:${image.mimeType};base64,${image.data.toString('base64')}`;
  const id = await createTask('image_to_video', { model, promptImage: dataUri, promptText: prompt.slice(0, 1000), ratio: VIDEO_RATIOS[opts.ratio || 'portrait'], duration });
  const t = await waitTask(id, 8 * 60_000);
  const url = t.output?.[0];
  if (!url) throw new Error('Runway returned no video');
  void recordAiCost('runway-video', model, (VIDEO_COST_PER_SEC_USD[model] ?? 0.05) * duration);
  const v = await download(url);
  return { ...v, mimeType: v.mimeType.startsWith('video/') ? v.mimeType : 'video/mp4', seconds: duration };
}

// 文章からリール（縦動画）を一気に作る: 画像 → 動画
export async function runwayReel(imagePrompt: string, motionPrompt: string, duration: 5 | 10 = 5) {
  const image = await runwayImage(imagePrompt, { ratio: 'portrait' });
  const video = await runwayVideo(image, motionPrompt, { ratio: 'portrait', duration });
  return { image, video };
}
