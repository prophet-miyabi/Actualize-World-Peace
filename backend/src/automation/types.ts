export type AutomationAction = 'navigate' | 'click' | 'type' | 'select' | 'waitFor' | 'extract';

export interface AutomationStep {
  action: AutomationAction;
  // click/type/select/waitFor/extract で対象を指定するCSSセレクタ
  selector?: string;
  // type: 入力する文字列 / select: 選ぶ値 / navigate: 遷移先URL（targetUrlと同一オリジンのみ許可）
  value?: string;
  // ダッシュボード上での手順の説明（任意）
  label?: string;
}

export interface StepLogEntry {
  index: number;
  action: AutomationAction;
  label?: string;
  ok: boolean;
  detail?: string; // extract結果、エラー内容など
}
