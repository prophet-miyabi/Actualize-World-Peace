import type { Page } from 'playwright';
import type { AutomationStep } from './types';

// 手順の保存時・実行直前の両方でチェックする。パスワード・決済・本人確認情報系の入力は
// 「リスクが高いため見送る」という運用方針（今回のスコープ決定）に基づき、機能自体で拒否する。
const BLOCKED_KEYWORDS = [
  'password', 'passwd', 'pwd',
  'card', 'cc-number', 'cc-csc', 'cc-exp', 'cvv', 'cvc', 'credit',
  'ssn', 'passport', 'mynumber', 'マイナンバー',
  'secret', 'apikey', 'api-key', 'api_key', 'token', 'otp', '暗証番号', 'パスワード'
];

const CAPTCHA_ORIGINS = ['recaptcha.net', 'google.com/recaptcha', 'hcaptcha.com', 'challenges.cloudflare.com'];

export const MAX_STEPS = 40;

function textMatchesBlockedKeyword(text: string): string | null {
  const lower = text.toLowerCase();
  const hit = BLOCKED_KEYWORDS.find((k) => lower.includes(k));
  return hit ?? null;
}

// ワークフロー保存時・実行前の静的チェック（DOMを見ずに、セレクタ・ラベル・入力値の文字列だけで判定）
export function validateWorkflowSteps(
  steps: AutomationStep[],
  targetUrl: string
): { ok: true } | { ok: false; index: number; reason: string } {
  if (steps.length === 0) return { ok: false, index: -1, reason: '手順が1つもありません' };
  if (steps.length > MAX_STEPS) return { ok: false, index: -1, reason: `手順は${MAX_STEPS}件までです` };

  let targetOrigin: string;
  try {
    targetOrigin = new URL(targetUrl).origin;
  } catch {
    return { ok: false, index: -1, reason: '接続先URLが不正です' };
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const haystacks = [step.selector, step.label, step.action === 'type' ? undefined : step.value]
      .filter((v): v is string => Boolean(v));
    for (const text of haystacks) {
      const hit = textMatchesBlockedKeyword(text);
      if (hit) return { ok: false, index: i, reason: `パスワード・決済・本人確認情報に関わる可能性がある手順は登録できません（"${hit}"）` };
    }
    // type の入力先（selector）自体はチェック対象。入力する値そのものは実行時に代入されるまで分からないため
    // ここでは対象フィールドの名前だけを見る（実際にpassword type等のDOM属性は実行直前にも再チェックする）
    if (step.action === 'type' && step.selector) {
      const hit = textMatchesBlockedKeyword(step.selector);
      if (hit) return { ok: false, index: i, reason: `入力先フィールドの指定にリスクの高いキーワードが含まれています（"${hit}"）` };
    }
    if (step.action === 'navigate') {
      if (!step.value) return { ok: false, index: i, reason: 'navigate には遷移先URLが必要です' };
      try {
        const dest = new URL(step.value);
        if (dest.origin !== targetOrigin) {
          return { ok: false, index: i, reason: '接続先と異なるドメインへの遷移は許可されていません（対象サイト内の操作に限定）' };
        }
      } catch {
        return { ok: false, index: i, reason: `navigate の遷移先URLが不正です: ${step.value}` };
      }
    }
    if ((step.action === 'click' || step.action === 'select' || step.action === 'waitFor' || step.action === 'extract') && !step.selector) {
      return { ok: false, index: i, reason: `${step.action} にはセレクタが必要です` };
    }
    if (step.action === 'type' && (!step.selector || step.value === undefined)) {
      return { ok: false, index: i, reason: 'type にはセレクタと入力値が必要です' };
    }
  }
  return { ok: true };
}

// 実行直前、実際のDOM要素を見て再チェックする（type="password" や autocomplete="cc-number" 等、
// ワークフロー作成時のセレクタ名からは分からない属性を実行時に検知するための最終防御）
export async function isRuntimeFieldBlocked(page: Page, selector: string): Promise<string | null> {
  try {
    const info = await page.locator(selector).first().evaluate((el: any) => ({
      type: (el.getAttribute('type') || '').toLowerCase(),
      autocomplete: (el.getAttribute('autocomplete') || '').toLowerCase(),
      name: (el.getAttribute('name') || '').toLowerCase(),
      id: (el.getAttribute('id') || '').toLowerCase()
    }));
    if (info.type === 'password') return 'type="password"のフィールドへの入力';
    const combined = `${info.autocomplete} ${info.name} ${info.id}`;
    const hit = textMatchesBlockedKeyword(combined);
    if (hit) return `フィールド属性にリスクの高いキーワード（"${hit}"）`;
    return null;
  } catch {
    // 要素が見つからない等はここでは判定せず、実行側の通常のエラー処理に委ねる
    return null;
  }
}

// CAPTCHA/ボット判定サービスのフレーム上での操作（＝検知回避の試み）を防ぐ
export function isCaptchaFrame(frameUrl: string): boolean {
  return CAPTCHA_ORIGINS.some((origin) => frameUrl.includes(origin));
}
