'use client';
import { STATE_COLOR, type SceneAgent, type SceneDept, type SceneLoop } from './OfficeScene';

// 3D が使えない端末（WebGL 非対応・コンテキスト喪失・省電力）向けの 2D オフィス図。
// 部署をタイル、役割を席として並べ、状態の色・承認待ち・警報を同じ記号で示す。375px でも横スクロールなし。
export default function OfficeMap2D({ departments, agents, loops, selectedAgent, selectedDept, showLoops, onSelectAgent, onSelectDept }: {
  departments: SceneDept[]; agents: SceneAgent[]; loops: SceneLoop[]; selectedAgent: string | null; selectedDept: string | null; showLoops: string;
  onSelectAgent: (key: string) => void; onSelectDept: (key: string) => void;
}) {
  const loopColor = (status?: string) => (status === 'waiting_approval' ? '#facc15' : status === 'failed' ? '#ef4444' : status === 'completed' ? '#eab308' : '#3b82f6');
  const activeLoops = loops.filter((l) => showLoops === 'all' || showLoops === l.key);
  const roleLoop = (role: string) => activeLoops.find((l) => l.steps.some((s) => s.role === role));
  return (
    <div className="h-full w-full overflow-y-auto p-2 bg-gradient-to-b from-indigo-50 to-slate-50">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
        {departments.map((d) => {
          const members = agents.filter((a) => a.department === d.key);
          const warn = d.health !== 'ok' || d.attention > 0;
          return (
            <div key={d.key} className={`rounded-2xl bg-white border-2 p-2 ${selectedDept === d.key ? 'border-violet-500' : 'border-slate-100'} ${d.key === 'executive' ? 'col-span-2 lg:col-span-3' : ''}`}>
              <button onClick={() => onSelectDept(d.key)} className="w-full text-left flex items-center gap-1.5 mb-1.5">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: d.color }} />
                <span className="text-[11px] font-black truncate">{d.name}</span>
                {warn && <span className="ml-auto w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
              </button>
              <div className="flex flex-wrap gap-1.5">
                {members.map((a) => {
                  const lp = roleLoop(a.key);
                  const run = lp?.runs[0];
                  return (
                    <button key={a.key} onClick={() => onSelectAgent(a.key)} title={a.currentTask?.title ?? a.state}
                      className={`relative rounded-xl border px-2 py-1 text-[10px] font-bold flex items-center gap-1 ${selectedAgent === a.key ? 'border-violet-500 bg-violet-50' : 'border-slate-200 bg-white'}`}
                      style={lp ? { boxShadow: `0 0 0 2px ${loopColor(run?.status)}33 inset` } : undefined}>
                      <span className="w-2 h-2 rounded-full" style={{ background: STATE_COLOR[a.state] ?? '#94a3b8' }} />
                      <span className="truncate max-w-[110px]">{a.name}</span>
                      {a.pendingApprovals > 0 && <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {activeLoops.length > 0 && (
        <div className="mt-2 space-y-1">
          {activeLoops.map((l) => {
            const run = l.runs[0];
            return (
              <div key={l.key} className="rounded-xl bg-white border px-2 py-1.5 text-[10px] flex items-center gap-1 overflow-x-auto">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: loopColor(run?.status) }} />
                <span className="font-bold shrink-0">{l.name}</span>
                {l.steps.map((s, i) => <span key={i} className={`shrink-0 rounded-full px-1.5 ${run && ['running', 'waiting_approval'].includes(run.status) && run.currentStep === i ? 'bg-blue-600 text-white' : 'bg-slate-100'}`}>{s.label}</span>)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
