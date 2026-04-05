"use client";
import MetricsPanel from "../../components/MetricsPanel";
import Sparkline from "../../components/Sparkline";

export default function ObservabilityPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Observabilidad</h1>
        <p className="text-sm text-slate-400 mt-1">Métricas del sistema en tiempo real</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <div className="text-3xl font-bold">—</div>
          <div className="text-sm text-slate-400 mt-1">Agent runs/s</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <div className="text-3xl font-bold">—</div>
          <div className="text-sm text-slate-400 mt-1">Bus retries</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <div className="text-3xl font-bold">—</div>
          <div className="text-sm text-slate-400 mt-1">Errores</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <div className="text-3xl font-bold">—</div>
          <div className="text-sm text-slate-400 mt-1">Latencia p95</div>
        </div>
      </div>

      {/* Grafana */}
      {process.env.NEXT_PUBLIC_GRAFANA_URL && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
          <h2 className="text-sm font-semibold mb-3">Dashboard</h2>
          <div className="aspect-video w-full rounded-lg overflow-hidden">
            <iframe
              src={process.env.NEXT_PUBLIC_GRAFANA_URL}
              className="h-full w-full"
              sandbox="allow-scripts"
            />
          </div>
        </div>
      )}

      <MetricsPanel />

      {/* Instructions */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="text-sm font-semibold mb-3">Configurar observabilidad</h2>
        <div className="text-sm text-slate-400 space-y-2">
          <p>1. Levanta Prometheus + Grafana con <code className="text-xs bg-slate-800 px-1.5 py-0.5 rounded">docker-compose -f docker-compose.observability.yml up</code></p>
          <p>2. Configura <code className="text-xs bg-slate-800 px-1.5 py-0.5 rounded">NEXT_PUBLIC_GRAFANA_URL</code> en el frontend</p>
          <p>3. El collector escucha en <code className="text-xs bg-slate-800 px-1.5 py-0.5 rounded">http://localhost:9464</code></p>
        </div>
      </div>
    </div>
  );
}
