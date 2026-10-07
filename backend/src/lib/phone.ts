// 日本の携帯電話番号だけを受け付け、E.164形式（+8190XXXXXXXX）にそろえる。
// 海外番号や固定電話を許すと、SMSを大量送信させて通信料を水増しする不正（SMSポンピング）の標的になるため。
export function normalizeJpMobile(input: unknown): string | null {
  let digits = String(input ?? '').replace(/[\s\-‐－ー()（）]/g, '');
  if (digits.startsWith('+81')) digits = `0${digits.slice(3)}`;
  else if (digits.startsWith('81') && digits.length === 12) digits = `0${digits.slice(2)}`;
  if (!/^0[6789]0\d{8}$/.test(digits)) return null;
  return `+81${digits.slice(1)}`;
}

// 画面表示用（+819012345678 → 090-****-5678）
export function maskJpMobile(e164: string): string {
  const local = `0${e164.replace(/^\+81/, '')}`;
  return `${local.slice(0, 3)}-****-${local.slice(-4)}`;
}
