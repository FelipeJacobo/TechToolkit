"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "../../lib/store";
import { getAuditLogs, exportAudit } from "../../lib/api";

export default function AuditPage() {
  const router = useRouter();
  const auth = useAppStore((s) => s.auth);
  const token = useAppStore((s) => s.auth?.accessToken);
  const [logs, setLogs] = useState<Array<{ id: string; action: string; created_at: string; meta: Record<string, unknown> }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth) { router.push("/login"); return; }
    if (!token) return;
    getAuditLogs(token).then((data) => { setLogs(data ?? []); setLoading(false); });
  }, [token, auth]);

  const handleExport = async () => {
    if (!token) return;
    const csv = await exportAudit(token);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "audit_export.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="flex items-center justify-center py-16 text-slate-400">Cargando auditoría...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Auditoría</h1>
          <p className="text-sm text-slate-400 mt-1">Registro completo de acciones del sistema</p>
        </div>
        <button onClick={handleExport} className="rounded-lg bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700 transition">
          Exportar CSV
        </button>
      </div>

      {logs.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <div className="text-4xl mb-3">🔒</div>
          <div>Sin registros de auditoría.</div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900/50 text-slate-400">
                <th className="text-left px-4 py-3 font-medium">Acción</th>
                <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Fecha</th>
                <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">Detalle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-800/20 transition">
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs">{log.action}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 hidden md:table-cell">
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 hidden lg:table-cell">
                    {log.meta ? JSON.stringify(log.meta).slice(0, 80) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
