import crypto from 'crypto';

// 利用者から預かる外部サービスの鍵（HarnessのAPIキーなど）を、DBに平文で置かないための暗号化（AES-256-GCM）。
// 鍵は SECRET_ENCRYPTION_KEY（64桁の16進数）を使う。未設定なら JWT_SECRET から導出する
// （その場合 JWT_SECRET を変えると復号できなくなるため、本番では SECRET_ENCRYPTION_KEY の設定を推奨）
function key(): Buffer {
  const hex = process.env.SECRET_ENCRYPTION_KEY;
  if (hex && /^[0-9a-f]{64}$/i.test(hex)) return Buffer.from(hex, 'hex');
  const base = process.env.JWT_SECRET;
  if (!base) throw new Error('暗号化の鍵が設定されていません');
  return crypto.createHash('sha256').update(`awp-secret-box:${base}`).digest();
}

export function seal(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

export function open(sealed: string): string {
  const [v, iv, tag, enc] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || !enc) throw new Error('暗号文の形式が正しくありません');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(enc, 'base64')), decipher.final()]).toString('utf8');
}
