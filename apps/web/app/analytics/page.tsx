"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "../../lib/store";
import { getAnalytics } from "../../lib/api";

type ProjectMetrics = {
  projectId: string;
  totalRuns: number;
  failedRuns: number;
  completedRuns: number;
  lastRunAt: string | null;
  costUsd?: number;
};

export default function AnalyticsPage() {
  const router = useRouter();
  const auth = useAppStore((s) => s.auth);
  const token = useAppStore((s) => s.auth?.accessToken);
  const [metrics, setMetrics] = useState<ProjectMetrics[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth) { router.push("/login"); return; }
    if (!token) return;
    getAnalytics(token).then((data) => { setMetrics(data ?? []); setLoading(false); });
  }, [token, auth]);

  if (loading) return <div className="flex items-center justify-center py-20 text-slate-400">Cargando métricas...</div>;

  const totalRuns = metrics.reduce((s, m) => s + m.totalRuns, 0);
  const totalCompleted = metrics.reduce((s, m) => s + m.completedRuns, 0);
  const totalFailed = metrics.reduce((s, m) => s + m.failedRuns, 0);
  const totalCost = metrics.reduce((s, m) => s + (m.costUsd ?? 0), 0);

  const csv = ["projectId,totalRuns,completedRuns,failedRuns,lastRunAt,costUsd", ...metrics.map((m) => `${m.projectId},${m.totalRuns},${m.completedRuns},${m.failedRuns},${m.lastRunAt ?? ""},${m.costUsd ?? 0}`)].join("\n");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Analíticas</h1>
        <p className="text-sm text-slate-400 mt-1">Rendimiento y costos por proyecto</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <div className="text-2xl font-bold">{totalRuns}</div>
          <div className="text-sm text-slate-400 mt-1">Total runs</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <div className="text-2xl font-bold text-emerald-400">{totalCompleted}</div>
          <div className="text-sm text-slate-400 mt-1">Completados</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <div className="text-2xl font-bold text-red-400">{totalFailed}</div>
          <div className="text-sm text-slate-400 mt-1">Fallidos</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <div className="text-2xl font-bold text-indigo-400">${totalCost.toFixed(2)}</div>
          <div className="text-sm text-slate-400 mt-1">Costo total</div>
        </div>
      </div>

      <div className="flex justify-end">
        <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`} download="analytics.csv" className="rounded-lg bg-slate-800 px-4 py-2 text-sm transition hover:bg-slate-700">
          Exportar CSV
        </a>
      </div>

      {metrics.length === 0 ? (
        <div className="text-center py-16 text-slate-500">Sin datos aún.</div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {metrics.map((m) => (
            <div key={m.projectId} className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
              <div className="font-mono text-sm truncate" title={m.projectId}>{m.projectId.slice(0, 16)}</div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                <div><div className="text-lg font-semibold">{m.totalRuns}</div><div className="text-slate-500">runs</div></div>
                <div><div className="text-lg font-semibold text-emerald-400">{m.completedRuns}</div><div className="text-slate-500">ok</div></div>
                <div><div className={`text-lg font-semibold ${m.failedRuns > 0 ? "text-red-400" : "text-slate-400"}`}>{m.failedRuns}</div><div className="text-slate-500">failed</div></div>
                <div><div className="text-lg font-semibold text-indigo-400">${m.costUsd?.toFixed(2)}</div><div className="text-slate-500">cost</div></div>
              </div>
              <div className="text-xs text-slate-600 mt-2">Último: {m.lastRunAt ? new Date(m.lastRunAt).toLocaleDateString() : "—"}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
