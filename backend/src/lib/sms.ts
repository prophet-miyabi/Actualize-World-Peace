import crypto from 'crypto';

// SMSによる確認コードの送信と照合（新規登録時の電話番号認証・パスワード再設定で使う）。
// 本番は Twilio Verify。コードの発行・有効期限・試行回数・SMSポンピング対策はTwilio側が行う。
// SMS_DEV_MODE=true は手元の開発環境専用で、SMSを送らずにコードをサーバーのログへ出す
// （本番で有効にすると誰でもログ閲覧者経由で認証を通せてしまうため、絶対に設定しないこと）。
export type SmsMode = 'twilio' | 'dev' | 'off';

export function smsMode(): SmsMode {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID, SMS_DEV_MODE } = process.env;
  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_VERIFY_SERVICE_SID) return 'twilio';
  if (SMS_DEV_MODE === 'true') return 'dev';
  return 'off';
}

const DEV_CODE_TTL_MS = 10 * 60 * 1000;
const devCodes = new Map<string, { code: string; expiresAt: number; attempts: number }>();

function twilioRequest(path: string, params: Record<string, string>) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID } = process.env;
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  return fetch(`https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE_SID}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params)
  });
}

export async function sendVerificationCode(phoneE164: string): Promise<void> {
  const mode = smsMode();
  if (mode === 'twilio') {
    const res = await twilioRequest('Verifications', { To: phoneE164, Channel: 'sms', Locale: 'ja' });
    if (!res.ok) throw new Error(`SMS送信に失敗しました（${res.status}）: ${(await res.text()).slice(0, 200)}`);
    return;
  }
  if (mode === 'dev') {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    devCodes.set(phoneE164, { code, expiresAt: Date.now() + DEV_CODE_TTL_MS, attempts: 0 });
    console.log(`[SMS_DEV_MODE] ${phoneE164} の確認コード: ${code}`);
    return;
  }
  throw new Error('SMS送信サービスが未設定です');
}

export async function checkVerificationCode(phoneE164: string, code: string): Promise<boolean> {
  if (!/^\d{4,10}$/.test(code)) return false;
  const mode = smsMode();
  if (mode === 'twilio') {
    const res = await twilioRequest('VerificationChecks', { To: phoneE164, Code: code });
    // 404 = 有効な確認がない（期限切れ・試行回数超過・未送信）
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`コードの確認に失敗しました（${res.status}）`);
    const data = (await res.json()) as { status?: string };
    return data.status === 'approved';
  }
  if (mode === 'dev') {
    const entry = devCodes.get(phoneE164);
    if (!entry || entry.expiresAt < Date.now() || entry.attempts >= 5 || code.length !== entry.code.length) return false;
    entry.attempts++;
    const ok = crypto.timingSafeEqual(Buffer.from(entry.code), Buffer.from(code));
    if (ok) devCodes.delete(phoneE164);
    return ok;
  }
  return false;
}
