// クルーの時刻はすべて日本時間（JST, UTC+9）で扱う。サーバーのタイムゾーンに依存しないよう、自前で計算する
const JST_OFFSET = 9 * 3600_000;

export function jstNow(date = new Date()) {
  const d = new Date(date.getTime() + JST_OFFSET);
  const day = d.toISOString().slice(0, 10);
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  return { day, minutes, weekday: d.getUTCDay() };
}

export const toHHMM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export const fromHHMM = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};

export function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
export function dayLabel(day: string) {
  const d = new Date(`${day}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WEEK[d.getUTCDay()]}）`;
}

export function daysBetween(a: string, b: string) {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000);
}
