'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, Line, OrbitControls, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';

// AWP Operations Office の 3D 表示（アイソメトリック）。
// 部署＝床のタイル、役割（デジタル社員）＝デスクとアバター、状態＝アバターの光の色、
// ループ＝部署間を流れる光のライン、警報＝赤い回転灯。クリックで右側（スマホは下）の詳細に飛ぶ。
export type SceneDept = { key: string; name: string; color: string; position: [number, number]; health: string; working: number; attention: number };
export type SceneAgent = { key: string; name: string; department: string; color: string; state: string; currentTask: { title: string } | null; health: number; pendingApprovals: number };
export type SceneLoop = { key: string; name: string; steps: { role: string; label: string }[]; runs: { status: string; currentStep: number }[] };

const DEBUG_CONTROLS = true;
const TILE = 7;           // 部署タイルの一辺
const GAP = 9;            // タイル中心の間隔
const DESK_PITCH = 1.6;

export const STATE_COLOR: Record<string, string> = {
  '待機中': '#94a3b8', 'タスク受領': '#60a5fa', '調査中': '#22c55e', '作成中': '#22c55e', '実行中': '#22c55e', '外部API呼び出し中': '#2dd4bf',
  'レビュー中': '#f97316', '承認待ち': '#facc15', '待ち状態': '#a78bfa', '成功': '#eab308', '失敗': '#ef4444', '再試行中': '#fb7185', '停止中': '#475569', '要対応': '#ef4444'
};
const WORKING = new Set(['調査中', '作成中', '実行中', '外部API呼び出し中', 'レビュー中']);
const ALARM = new Set(['失敗', '要対応']);

function deptCenter(d: SceneDept): [number, number, number] {
  return [d.position[0] * GAP, 0, d.position[1] * GAP];
}

// 部署内のデスク配置（最大 3 列）
export function agentPosition(dept: SceneDept, index: number, count: number): [number, number, number] {
  const [cx, , cz] = deptCenter(dept);
  const cols = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(count))));
  const rows = Math.ceil(count / cols);
  const col = index % cols, row = Math.floor(index / cols);
  const x = cx + (col - (cols - 1) / 2) * DESK_PITCH;
  const z = cz + (row - (rows - 1) / 2) * DESK_PITCH + 0.6;
  return [x, 0, z];
}

function Avatar({ agent, position, selected, onClick }: { agent: SceneAgent; position: [number, number, number]; selected: boolean; onClick: () => void }) {
  const ring = useRef<THREE.Mesh>(null);
  const body = useRef<THREE.Group>(null);
  const lamp = useRef<THREE.Mesh>(null);
  const color = STATE_COLOR[agent.state] ?? '#94a3b8';
  const working = WORKING.has(agent.state);
  const alarm = ALARM.has(agent.state);
  const [hover, setHover] = useState(false);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (ring.current) { const s = working ? 1 + Math.sin(t * 4) * 0.08 : 1; ring.current.scale.set(s, s, s); (ring.current.material as THREE.MeshStandardMaterial).emissiveIntensity = working ? 0.9 + Math.sin(t * 4) * 0.4 : 0.5; }
    if (body.current) body.current.position.y = working ? 0.05 + Math.abs(Math.sin(t * 3 + position[0])) * 0.08 : 0.05;
    if (lamp.current) (lamp.current.material as THREE.MeshStandardMaterial).emissiveIntensity = alarm ? (Math.sin(t * 8) > 0 ? 2.5 : 0.2) : 0;
  });
  return (
    <group position={position}>
      {/* デスク */}
      <mesh position={[0, 0.3, -0.55]} castShadow receiveShadow onClick={(e) => { e.stopPropagation(); onClick(); }} onPointerOver={() => setHover(true)} onPointerOut={() => setHover(false)}>
        <boxGeometry args={[1.2, 0.08, 0.6]} />
        <meshStandardMaterial color="#e2e8f0" />
      </mesh>
      <mesh position={[0, 0.55, -0.72]}>
        <boxGeometry args={[0.5, 0.32, 0.04]} />
        <meshStandardMaterial color="#0f172a" emissive={working ? color : '#000'} emissiveIntensity={working ? 0.6 : 0} />
      </mesh>
      {/* 足元の状態リング */}
      <mesh ref={ring} position={[0, 0.02, 0.1]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.36, 0.48, 32]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} transparent opacity={0.9} />
      </mesh>
      {/* アバター */}
      <group ref={body} onClick={(e) => { e.stopPropagation(); onClick(); }} onPointerOver={() => setHover(true)} onPointerOut={() => setHover(false)}>
        <mesh position={[0, 0.4, 0.1]} castShadow>
          <capsuleGeometry args={[0.22, 0.4, 6, 12]} />
          <meshStandardMaterial color={agent.color} />
        </mesh>
        <mesh position={[0, 0.9, 0.1]} castShadow>
          <sphereGeometry args={[0.2, 16, 16]} />
          <meshStandardMaterial color="#fde8d7" />
        </mesh>
        {selected && (
          <mesh position={[0, 1.35, 0.1]} rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.14, 0.3, 4]} />
            <meshStandardMaterial color="#7c3aed" emissive="#7c3aed" emissiveIntensity={0.8} />
          </mesh>
        )}
      </group>
      {/* 警報ランプ */}
      <mesh ref={lamp} position={[0.5, 1.0, -0.6]}>
        <sphereGeometry args={[0.1, 12, 12]} />
        <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={0} />
      </mesh>
      {agent.pendingApprovals > 0 && (
        <mesh position={[-0.5, 0.45, -0.3]} rotation={[-0.4, 0, 0]}>
          <boxGeometry args={[0.28, 0.02, 0.36]} />
          <meshStandardMaterial color="#facc15" emissive="#facc15" emissiveIntensity={0.5} />
        </mesh>
      )}
      {/* 名札: 画面が混み合わないよう、稼働中・要対応・選択中・ホバー時だけ出す（待機中は足元の色だけ） */}
      {(hover || selected || working || alarm || agent.state === '承認待ち') && (
        <Html position={[0, 1.5, 0.1]} center style={{ pointerEvents: 'none' }} zIndexRange={[12, 0]}>
          <div style={{ fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap', background: hover || selected ? '#0f172a' : 'rgba(255,255,255,.9)', color: hover || selected ? '#fff' : '#0f172a', padding: '1px 6px', borderRadius: 999, border: `1.5px solid ${color}` }}>
            {agent.name}{hover && agent.currentTask ? `：${agent.currentTask.title.slice(0, 18)}` : hover ? `：${agent.state}` : ''}
          </div>
        </Html>
      )}
    </group>
  );
}

function DeptTile({ dept, count, selected, onClick }: { dept: SceneDept; count: number; selected: boolean; onClick: () => void }) {
  const [cx, , cz] = deptCenter(dept);
  const warn = dept.health !== 'ok' || dept.attention > 0;
  return (
    <group position={[cx, 0, cz]}>
      <RoundedBox args={[TILE, 0.2, TILE]} radius={0.3} smoothness={4} position={[0, -0.1, 0]} receiveShadow onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <meshStandardMaterial color={selected ? '#ede9fe' : '#f8fafc'} />
      </RoundedBox>
      {/* 部署の縁取り（担当色） */}
      <mesh position={[0, 0.01, -TILE / 2 + 0.18]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[TILE - 0.6, 0.24]} />
        <meshStandardMaterial color={dept.color} emissive={dept.color} emissiveIntensity={0.3} />
      </mesh>
      {/* 壁（奥と左） */}
      <mesh position={[0, 0.9, -TILE / 2]} receiveShadow>
        <boxGeometry args={[TILE, 1.8, 0.1]} />
        <meshStandardMaterial color="#ffffff" transparent opacity={0.6} />
      </mesh>
      <mesh position={[-TILE / 2, 0.9, 0]} receiveShadow>
        <boxGeometry args={[0.1, 1.8, TILE]} />
        <meshStandardMaterial color="#ffffff" transparent opacity={0.45} />
      </mesh>
      {warn && (
        <mesh position={[TILE / 2 - 0.4, 1.9, -TILE / 2 + 0.4]}>
          <sphereGeometry args={[0.16, 12, 12]} />
          <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={1.5} />
        </mesh>
      )}
      <Html position={[0, 2.0, -TILE / 2 + 0.3]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div style={{ whiteSpace: 'nowrap', fontSize: 10, fontWeight: 900, color: '#0f172a', background: 'rgba(255,255,255,.92)', borderLeft: `3px solid ${dept.color}`, padding: '2px 6px', borderRadius: 6 }}>
          {dept.name} <span style={{ fontWeight: 600, color: '#64748b' }}>{count}名・稼働{dept.working}</span>
        </div>
      </Html>
    </group>
  );
}

// ループの光るライン＋往復するデータパケット
function LoopLine({ points, color, speed, active }: { points: [number, number, number][]; color: string; speed: number; active: boolean }) {
  const packet = useRef<THREE.Mesh>(null);
  const curve = useMemo(() => new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), true, 'catmullrom', 0.3), [points]);
  const linePts = useMemo(() => curve.getPoints(Math.max(40, points.length * 16)).map((v) => [v.x, v.y, v.z] as [number, number, number]), [curve, points.length]);
  useFrame(({ clock }) => {
    if (!packet.current) return;
    const t = (clock.getElapsedTime() * speed) % 1;
    const p = curve.getPointAt(t);
    packet.current.position.set(p.x, p.y, p.z);
  });
  return (
    <group>
      <Line points={linePts} color={color} lineWidth={active ? 2.5 : 1.2} transparent opacity={active ? 0.9 : 0.35} dashed={!active} dashSize={0.4} gapSize={0.3} />
      {active && (
        <mesh ref={packet}>
          <sphereGeometry args={[0.16, 12, 12]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2} />
        </mesh>
      )}
    </group>
  );
}

function CeoBoard({ counts, position }: { counts: { running: number; done: number; waitingApproval: number; failed: number }; position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 1.4, -2.4]}>
        <boxGeometry args={[4.4, 1.6, 0.1]} />
        <meshStandardMaterial color="#0f172a" emissive="#1e293b" emissiveIntensity={0.6} />
      </mesh>
      <Html position={[0, 1.4, -2.3]} center transform={false} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div style={{ display: 'flex', gap: 12, fontSize: 10, color: '#fff', background: '#0f172a', padding: '6px 12px', borderRadius: 8, border: '1px solid #334155', whiteSpace: 'nowrap' }}>
          {[['実行中', counts.running, '#22c55e'], ['完了', counts.done, '#eab308'], ['承認待ち', counts.waitingApproval, '#facc15'], ['失敗', counts.failed, '#ef4444']].map(([l, v, c]) => (
            <div key={String(l)} style={{ textAlign: 'center', minWidth: 36 }}><div style={{ fontSize: 16, fontWeight: 900, color: String(c), lineHeight: 1.1 }}>{String(v)}</div><div style={{ opacity: 0.8 }}>{String(l)}</div></div>
          ))}
        </div>
      </Html>
      {/* CEO の席 */}
      <mesh position={[0, 0.35, 0.6]} castShadow>
        <boxGeometry args={[1.8, 0.1, 0.8]} />
        <meshStandardMaterial color="#c4b5fd" />
      </mesh>
    </group>
  );
}

// 画面サイズに合わせてオフィス全体（約46単位）が収まる倍率にする。スマホの小さな画面でも全体が見える
function FitZoom() {
  const { camera, size } = useThree();
  useEffect(() => {
    const cam = camera as THREE.OrthographicCamera;
    cam.zoom = Math.max(5, Math.min(40, Math.min(size.width, size.height * 1.5) / 46));
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

function CameraRig({ focus }: { focus: [number, number, number] | null }) {
  const { controls } = useThree() as unknown as { controls: { target: THREE.Vector3; update: () => void } | null };
  const target = useRef(new THREE.Vector3(0, 0, 0));
  useFrame(() => {
    if (!controls) return;
    const dest = focus ? new THREE.Vector3(focus[0], 0, focus[2]) : new THREE.Vector3(0, 0, 0);
    target.current.lerp(dest, 0.08);
    controls.target.copy(target.current);
    controls.update();
  });
  return null;
}

export default function OfficeScene({ departments, agents, loops, counts, selectedAgent, selectedDept, focusDept, showLoops, onSelectAgent, onSelectDept, onContextLost }: {
  departments: SceneDept[]; agents: SceneAgent[]; loops: SceneLoop[]; counts: { running: number; done: number; waitingApproval: number; failed: number };
  selectedAgent: string | null; selectedDept: string | null; focusDept: string | null; showLoops: string | 'all' | 'none';
  onSelectAgent: (key: string) => void; onSelectDept: (key: string) => void; onContextLost?: () => void;
}) {
  const deptBy = useMemo(() => Object.fromEntries(departments.map((d) => [d.key, d])), [departments]);
  const positions = useMemo(() => {
    const out: Record<string, [number, number, number]> = {};
    for (const d of departments) {
      const members = agents.filter((a) => a.department === d.key);
      members.forEach((a, i) => { out[a.key] = agentPosition(d, i, members.length); });
    }
    return out;
  }, [departments, agents]);
  const loopLines = useMemo(() => loops.filter((l) => showLoops === 'all' || showLoops === l.key).map((l) => {
    const pts = l.steps.map((s) => positions[s.role]).filter(Boolean).map(([x, , z]) => [x, 1.6, z] as [number, number, number]);
    const run = l.runs[0];
    const active = !!run && ['running', 'waiting_approval'].includes(run.status);
    const color = run?.status === 'waiting_approval' ? '#facc15' : run?.status === 'failed' ? '#ef4444' : run?.status === 'completed' ? '#eab308' : '#3b82f6';
    return { key: l.key, pts, active, color };
  }).filter((l) => l.pts.length >= 2), [loops, positions, showLoops]);
  const focus = focusDept && deptBy[focusDept] ? deptCenter(deptBy[focusDept]) : null;
  const exec = deptBy.executive;

  return (
    <Canvas shadows dpr={[1, 1.5]} orthographic camera={{ position: [26, 26, 26], zoom: 22, near: -100, far: 200 }} style={{ background: 'linear-gradient(180deg,#eef2ff,#f8fafc)' }}
      onCreated={({ gl, camera }) => { camera.lookAt(0, 0, 0); gl.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); onContextLost?.(); }, { passive: false }); }}>
      {DEBUG_CONTROLS && <OrbitControls makeDefault enablePan enableRotate enableZoom minZoom={10} maxZoom={70} maxPolarAngle={Math.PI / 2.3} minPolarAngle={0.5} />}
      {DEBUG_CONTROLS && <FitZoom />}
      {DEBUG_CONTROLS && <CameraRig focus={focus} />}
      <ambientLight intensity={0.9} />
      <directionalLight position={[12, 20, 8]} intensity={1.1} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
      {/* 床 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.25, 0]} receiveShadow onClick={() => onSelectDept('')}>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#e2e8f0" />
      </mesh>
      {departments.map((d) => (
        <DeptTile key={d.key} dept={d} count={agents.filter((a) => a.department === d.key).length} selected={selectedDept === d.key} onClick={() => onSelectDept(d.key)} />
      ))}
      {exec && <CeoBoard counts={counts} position={deptCenter(exec)} />}
      {agents.map((a) => positions[a.key] && (
        <Avatar key={a.key} agent={a} position={positions[a.key]} selected={selectedAgent === a.key} onClick={() => onSelectAgent(a.key)} />
      ))}
      {loopLines.map((l, i) => <LoopLine key={l.key} points={l.pts} color={l.color} speed={0.08 + i * 0.01} active={l.active} />)}
    </Canvas>
  );
}
