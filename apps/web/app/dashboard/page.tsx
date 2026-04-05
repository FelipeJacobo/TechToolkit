"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "../../lib/store";
import { listProjects, createProject, listRuns, getBillingUsage, getBillingPlan } from "../../lib/api";

export default function DashboardPage() {
  const router = useRouter();
  const auth = useAppStore((s) => s.auth);
  const token = useAppStore((s) => s.auth?.accessToken);
  const [projects, setProjects] = useState<Array<{ id: string; name: string; repo_url?: string | null; created_at: string }>>([]);
  const [runs, setRuns] = useState<Array<{ id: string; status: string; trace_id: string }>>([]);
  const [billing, setBilling] = useState<any>(null);
  const [plan, setPlan] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newRepo, setNewRepo] = useState("");

  useEffect(() => {
    if (!auth) { router.push("/login"); return; }
    if (!token) return;
    loadData();
  }, [auth, token]);

  const loadData = async () => {
    if (!token) return;
    try {
      const [p, r, b, pl] = await Promise.all([
        listProjects(token),
        listRuns(token),
        getBillingUsage(token).catch(() => null),
        getBillingPlan(token).catch(() => null),
      ]);
      setProjects(p ?? []);
      setRuns(r ?? []);
      setBilling(b);
      setPlan(pl);
    } catch { /* noop */ } finally { setLoading(false); }
  };

  const handleCreate = async () => {
    if (!token || !newName.trim()) return;
    await createProject(token, newName, newRepo || undefined);
    setNewName("");
    setNewRepo("");
    await loadData();
  };

  if (loading) return <div className="flex items-center justify-center py-20 text-slate-400">Cargando…</div>;

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-slate-400 mt-1">Bienvenido{auth?.email ? `, ${auth.email.split("@")[0]}` : ""}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Proyectos" value={projects.length} icon="📁" />
        <StatCard label="Ejecuciones" value={runs.length} icon="⚡" />
        <StatCard label="Completadas" value={runs.filter(r => r.status === "completed").length} icon="✅" color="text-emerald-400" />
        <StatCard label="Costo" value={billing ? `$${billing.cost ?? 0}` : "—"} icon="💰" color="text-indigo-400" />
      </div>

      {/* Quick actions */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="text-sm font-semibold mb-3">Crear proyecto rápido</h2>
        <div className="flex gap-2">
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nombre" className="flex-1 rounded-lg bg-slate-950 border border-slate-800 p-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50" />
          <input value={newRepo} onChange={e => setNewRepo(e.target.value)} placeholder="Repo URL (opcional)" className="flex-1 rounded-lg bg-slate-950 border border-slate-800 p-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50" />
          <button onClick={handleCreate} disabled={!newName.trim()} className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium disabled:opacity-40 transition">Crear</button>
        </div>
      </div>

      {/* Recent */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent Projects */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Proyectos</h2>
            <a href="/projects" className="text-xs text-indigo-400 hover:text-indigo-300">Ver todos →</a>
          </div>
          {projects.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">Sin proyectos. Crea uno para empezar.</p>
          ) : (
            <div className="space-y-2">
              {projects.slice(0, 4).map(p => (
                <a key={p.id} href={`/projects/${p.id}`} className="flex items-center justify-between p-3 rounded bg-slate-950/50 hover:bg-slate-800/40 transition group">
                  <div>
                    <div className="text-sm font-medium">{p.name}</div>
                    <div className="text-xs text-slate-500">{p.repo_url ?? "Sin repo"}</div>
                  </div>
                  <span className="text-xs text-indigo-400 opacity-0 group-hover:opacity-100 transition">Abrir →</span>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Recent Runs */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Ejecuciones recientes</h2>
            <a href="/runs" className="text-xs text-indigo-400 hover:text-indigo-300">Ver todas →</a>
          </div>
          {runs.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">Sin ejecuciones aún.</p>
          ) : (
            <div className="space-y-2">
              {runs.slice(0, 4).map(r => (
                <a key={r.id} href={`/runs/${r.id}`} className="flex items-center justify-between p-3 rounded bg-slate-950/50 hover:bg-slate-800/40 transition">
                  <span className="text-xs text-slate-400 font-mono">{r.id.slice(0, 12)}…</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${r.status === "completed" ? "bg-emerald-400/10 text-emerald-400" : r.status === "failed" ? "bg-red-400/10 text-red-400" : "bg-slate-400/10 text-slate-400"}`}>{r.status}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, color = "text-slate-100" }: { label: string; value: string | number; icon: string; color?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">{icon}</span>
        <span className="text-xs text-slate-500">{label}</span>
      </div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
}
