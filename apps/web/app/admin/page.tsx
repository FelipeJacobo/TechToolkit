"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "../../lib/store";
import { adminRetention } from "../../lib/api";

export default function AdminPage() {
  const router = useRouter();
  const auth = useAppStore((s) => s.auth);
  const [adminToken, setAdminToken] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleRetention = async () => {
    if (!adminToken) return;
    setLoading(true);
    try {
      const data = await adminRetention(adminToken);
      setResult(JSON.stringify(data));
    } catch (err: any) {
      setResult(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Admin Console</h1>
        <p className="text-sm text-slate-400 mt-1">Gestión del sistema y mantenimiento</p>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="text-sm font-semibold mb-3">Retención de datos</h2>
        <p className="text-xs text-slate-500 mb-4">Elimina logs, trazas y embeddings antiguos según los días de retención configurados.</p>
        <div className="flex gap-3">
          <input
            type="password"
            value={adminToken}
            onChange={(e) => setAdminToken(e.target.value)}
            placeholder="Admin Token"
            className="flex-1 rounded-lg bg-slate-950 border border-slate-800 p-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          />
          <button
            onClick={handleRetention}
            disabled={!adminToken || loading}
            className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium disabled:opacity-40 transition hover:bg-red-500"
          >
            {loading ? "Ejecutando..." : "Ejecutar retención"}
          </button>
        </div>
        {result && (
          <pre className="mt-3 text-xs bg-slate-950 rounded-lg p-3 text-slate-300 overflow-auto">{result}</pre>
        )}
      </div>
    </div>
  );
}
