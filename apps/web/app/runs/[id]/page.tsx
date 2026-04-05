"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "../../../lib/store";
import { getRunLogs, getTrace } from "../../../lib/api";

type Params = { params: { id: string } };

export default function RunDetailPage({ params }: Params) {
  const router = useRouter();
  const auth = useAppStore((s) => s.auth);
  const token = useAppStore((s) => s.auth?.accessToken);
  const [logs, setLogs] = useState<Array<{ id: string; level: string; message: string; meta?: Record<string, unknown>; created_at: string }>>([]);
  const [trace, setTrace] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth) { router.push("/login"); return; }
    if (!token) return;
    loadRun();
  }, [token, auth]);

  const loadRun = async () => {
    if (!token) return;
    try {
      const [logsData, traceData] = await Promise.all([
        getRunLogs(token, params.id),
        getTrace(token, params.id).catch(() => null)
      ]);
      setLogs(logsData ?? []);
      setTrace(traceData);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center py-16 text-slate-400">Cargando logs...</div>;

  const levelColor = (level: string) => {
    switch (level) {
      case "error": return "text-red-400";
      case "warn": return "text-amber-400";
      case "alert": return "text-red-500";
      default: return "text-slate-400";
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <a href="/runs" className="text-xs text-slate-500 hover:text-slate-300">← Ejecuciones</a>
        <h1 className="text-2xl font-bold mt-1 font-mono text-sm">{params.id}</h1>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Logs ({logs.length})</h2>
          <span className="text-xs text-slate-500">
            {logs.length > 0 && new Date(logs[0].created_at).toLocaleString()}
          </span>
        </div>
        {logs.length === 0 ? (
          <div className="text-center py-10 text-slate-500 text-sm">Sin logs para esta ejecución</div>
        ) : (
          <div className="divide-y divide-slate-800/30">
            {logs.map((log) => (
              <div key={log.id} className="p-4 hover:bg-slate-800/20 transition">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-mono uppercase ${levelColor(log.level)}`}>{log.level}</span>
                  <span className="text-xs text-slate-600">{new Date(log.created_at).toLocaleString()}</span>
                </div>
                <div className="text-sm text-slate-200">{log.message}</div>
                {log.meta && (
                  <pre className="text-xs text-slate-500 mt-1 bg-slate-950 rounded p-2 overflow-auto max-h-32">
                    {JSON.stringify(log.meta, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {trace && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
          <h2 className="text-sm font-semibold mb-3">Trace</h2>
          <pre className="text-xs bg-slate-950 rounded-lg p-4 overflow-auto max-h-80 text-slate-300">
            {JSON.stringify(trace, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
