"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "../../lib/store";
import { listApiKeys, createApiKey, deleteApiKey } from "../../lib/api";

type ApiKey = { id: string; project_id: string | null; role: string; expires_at: string | null; created_at: string };

export default function SettingsPage() {
  const router = useRouter();
  const auth = useAppStore((s) => s.auth);
  const token = useAppStore((s) => s.auth?.accessToken);
  const [projectId, setProjectId] = useState("");
  const [role, setRole] = useState("viewer");
  const [expires, setExpires] = useState("30");
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [lastCreated, setLastCreated] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth) { router.push("/login"); return; }
    if (!token) return;
    listApiKeys(token).then((data) => { setKeys(data ?? []); setLoading(false); });
  }, [token, auth]);

  const handleCreate = async () => {
    if (!token) return;
    const result = await createApiKey(token, projectId || undefined, role, Number(expires));
    setLastCreated(result.apiKey ?? null);
    const updated = await listApiKeys(token);
    setKeys(updated ?? []);
  };

  const handleDelete = async (id: string) => {
    if (!token) return;
    await deleteApiKey(token, id);
    const updated = await listApiKeys(token);
    setKeys(updated ?? []);
  };

  if (loading) return <div className="flex items-center justify-center py-16 text-slate-400">Cargando ajustes...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Ajustes</h1>
        <p className="text-sm text-slate-400 mt-1">API keys y configuración de acceso</p>
      </div>

      {/* Profile */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="text-sm font-semibold mb-3">Tu cuenta</h2>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center text-lg font-bold text-white">
            {auth?.email[0]?.toUpperCase()}
          </div>
          <div>
            <div className="font-medium">{auth?.email}</div>
            <div className="text-xs text-slate-500">ID: {auth?.id}</div>
          </div>
        </div>
      </div>

      {/* Create API Key */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="text-sm font-semibold mb-3">Crear API Key</h2>
        {lastCreated && (
          <div className="mb-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3">
            <div className="text-xs text-emerald-400 font-mono">{lastCreated}</div>
            <div className="text-xs text-slate-500 mt-1">Copia esta clave, no se mostrará de nuevo</div>
          </div>
        )}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <input
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            placeholder="Project ID (opcional)"
            className="rounded-lg bg-slate-950 border border-slate-800 p-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="rounded-lg bg-slate-950 border border-slate-800 p-2.5 text-sm"
          >
            <option value="owner">owner</option>
            <option value="editor">editor</option>
            <option value="viewer">viewer</option>
          </select>
          <input
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
            placeholder="Días de expiración"
            type="number"
            className="rounded-lg bg-slate-950 border border-slate-800 p-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          />
          <button onClick={handleCreate} className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium transition hover:bg-indigo-500">
            Crear clave
          </button>
        </div>
      </div>

      {/* API Keys */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="text-sm font-semibold mb-3">API Keys ({keys.length})</h2>
        {keys.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-4">Sin API keys creadas</p>
        ) : (
          <div className="space-y-2">
            {keys.map((key) => (
              <div key={key.id} className="flex items-center justify-between bg-slate-950/50 rounded-lg p-3">
                <div className="text-xs">
                  <div className="text-slate-300 font-mono">{key.id}</div>
                  <div className="text-slate-500 mt-0.5">
                    {key.project_id ?? "global"} · {key.role} · {key.expires_at ? `exp ${new Date(key.expires_at).toLocaleDateString()}` : "sin exp"}
                  </div>
                </div>
                <button onClick={() => handleDelete(key.id)} className="text-red-400 text-xs hover:text-red-300 transition">Eliminar</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
