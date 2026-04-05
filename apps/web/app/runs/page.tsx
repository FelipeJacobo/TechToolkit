"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "../../lib/store";
import { listRuns } from "../../lib/api";

type Run = { id: string; status: string; trace_id: string };

export default function RunsPage() {
  const router = useRouter();
  const auth = useAppStore((s) => s.auth);
  const token = useAppStore((s) => s.auth?.accessToken);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth) { router.push("/login"); return; }
    if (!token) return;
    listRuns(token).then((d) => { setRuns(d ?? []); setLoading(false); });
  }, [auth, token]);

  if (loading) return <div className="flex items-center justify-center py-20 text-slate-400">Cargando…</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Ejecuciones</h1>
      {runs.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-12">Sin ejecuciones aún.</p>
      ) : (
        <div className="rounded-xl border border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-900/50 text-left text-slate-400">
              <th className="px-4 py-3 font-medium">ID</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3 font-medium hidden md:table-cell">Trace</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-800/50">
              {runs.map((r) => (
                <tr key={r.id} className="hover:bg-slate-800/20 transition cursor-pointer" onClick={() => router.push(`/runs/${r.id}`)}>
                  <td className="px-4 py-3 font-mono text-xs">{r.id.slice(0, 12)}…</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs ${r.status === "completed" ? "bg-emerald-400/10 text-emerald-400" : r.status === "failed" ? "bg-red-400/10 text-red-400" : "bg-slate-400/10 text-slate-400"}`}>{r.status}</span></td>
                  <td className="px-4 py-3 text-xs text-slate-500 hidden md:table-cell">{r.trace_id?.slice(0, 12)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
