"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "../../lib/store";
import { getAlerts } from "../../lib/api";

export default function AlertsPage() {
  const router = useRouter();
  const auth = useAppStore((s) => s.auth);
  const token = useAppStore((s) => s.auth?.accessToken);
  const [alerts, setAlerts] = useState<Array<{ id: string; message: string; created_at: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth) { router.push("/login"); return; }
    if (!token) return;
    getAlerts(token).then((data) => { setAlerts(data ?? []); setLoading(false); });
  }, [token, auth]);

  if (loading) return <div className="flex items-center justify-center py-16 text-slate-400">Cargando alertas...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Alertas</h1>
        <p className="text-sm text-slate-400 mt-1">Alertas del sistema y ejecuciones</p>
      </div>

      {alerts.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <div className="text-4xl mb-3">🔔</div>
          <div>No hay alertas. ¡Todo en orden!</div>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((a) => (
            <div key={a.id} className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-amber-400 text-sm font-semibold">⚠️ Alerta</span>
                <span className="text-xs text-slate-500">{new Date(a.created_at).toLocaleString()}</span>
              </div>
              <p className="text-sm text-slate-300">{a.message}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
