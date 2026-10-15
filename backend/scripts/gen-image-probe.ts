// 画像モデルの比較用（ローカル検証）: GEMINI_IMAGE_MODEL を切り替えて同じ指示文で1枚作る
import 'dotenv/config';
import * as fs from 'fs';
import { generateImage } from '../src/ai/design';
const m = process.env.GEMINI_IMAGE_MODEL!;
const out = process.argv[2];
const prompt = process.argv[3] || 'A high-quality photograph for the hero section of a small business website. A quiet barbershop interior with a vintage leather chair, warm tungsten light, vinyl records on a shelf, wide composition with calm negative space. No text, no letters, no logos, no watermarks, no signage.';
(async () => { const t = Date.now(); const img = await generateImage(prompt); fs.writeFileSync(out, img.data); console.log(m, img.mimeType, img.data.length, (Date.now() - t) + 'ms'); })().catch((e) => console.log(m, 'ERR', String(e?.message ?? e).slice(0, 300)));
