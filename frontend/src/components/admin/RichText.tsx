'use client';

// Markdown のごく一部（見出し・太字・箇条書き・表）を読みやすく表示する軽量レンダラー。
// 外部ライブラリなし。議事録・メモリ・エージェントの報告に使う
export default function RichText({ text, className = '' }: { text: string; className?: string }) {
  const lines = text.split('\n');
  const out: React.ReactNode[] = [];
  let table: string[][] | null = null;
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, j) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={j}>{part.slice(2, -2)}</strong>
      : part.startsWith('`') && part.endsWith('`') ? <code key={j} className="bg-gray-100 rounded px-1 text-[0.9em]">{part.slice(1, -1)}</code>
      : <span key={j}>{part}</span>
  );
  const flushTable = (k: number) => {
    if (!table) return;
    const [head, ...rows] = table;
    out.push(
      <div key={`t${k}`} className="overflow-x-auto my-2">
        <table className="text-xs border-collapse w-full">
          <thead><tr>{head.map((h, i) => <th key={i} className="border px-2 py-1 bg-gray-50 text-left font-bold">{inline(h)}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="border px-2 py-1 align-top">{inline(c)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
    table = null;
  };
  lines.forEach((line, i) => {
    const cells = line.trim().startsWith('|') ? line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()) : null;
    if (cells) {
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) return; // 区切り行
      (table ??= []).push(cells);
      return;
    }
    flushTable(i);
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { const lv = h[1].length; out.push(<p key={i} className={`font-black ${lv === 1 ? 'text-lg mt-4' : lv === 2 ? 'text-base mt-4' : 'text-sm mt-3'}`}>{inline(h[2])}</p>); return; }
    if (/^\s*[-・]\s+/.test(line)) { out.push(<p key={i} className="pl-4 -indent-3 text-sm">・{inline(line.replace(/^\s*[-・]\s+/, ''))}</p>); return; }
    if (/^\s*\d+\.\s+/.test(line)) { out.push(<p key={i} className="pl-5 -indent-4 text-sm">{inline(line.trim())}</p>); return; }
    if (/^>\s?/.test(line)) { out.push(<p key={i} className="border-l-4 border-violet-200 pl-3 text-sm text-gray-600">{inline(line.replace(/^>\s?/, ''))}</p>); return; }
    if (/^---+$/.test(line.trim())) { out.push(<hr key={i} className="my-3" />); return; }
    out.push(<p key={i} className={`text-sm ${line.trim() ? '' : 'h-2'}`}>{inline(line)}</p>);
  });
  flushTable(lines.length);
  return <div className={`leading-relaxed ${className}`}>{out}</div>;
}
