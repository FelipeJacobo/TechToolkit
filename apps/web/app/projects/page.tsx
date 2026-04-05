"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "../../lib/store";
import { listProjects, createProject } from "../../lib/api";

export default function ProjectsPage() {
  const router = useRouter();
  const auth = useAppStore((s) => s.auth);
  const token = useAppStore((s) => s.auth?.accessToken);
  const [projects, setProjects] = useState<Array<{ id: string; name: string; repo_url?: string | null; created_at: string }>>([]);
  const [newName, setNewName] = useState("");
  const [newRepo, setNewRepo] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!auth) { router.push("/login"); return; }
    if (!token) return;
    listProjects(token).then(setProjects);
  }, [token, auth]);

  const handleCreate = async () => {
    if (!token || !newName.trim() || creating) return;
    setCreating(true);
    try {
      const result = await createProject(token, newName, newRepo || undefined);
      setNewName("");
      setNewRepo("");
      if (token) {
        const updated = await listProjects(token);
        setProjects(updated ?? []);
      }
      if (result?.id) router.push(`/projects/${result.id}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Proyectos</h1>
          <p className="text-sm text-slate-400 mt-1">Gestiona los repositorios y tareas de tu equipo.</p>
        </div>
      </div>

      {/* Create */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="text-sm font-semibold mb-3">Crear proyecto</h2>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1 rounded-lg bg-slate-950 border border-slate-800 p-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            placeholder="Nombre del proyecto"
          />
          <input
            value={newRepo}
            onChange={(e) => setNewRepo(e.target.value)}
            className="flex-1 rounded-lg bg-slate-950 border border-slate-800 p-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            placeholder="Repo URL (opcional)"
          />
          <button
            onClick={handleCreate}
            disabled={!newName.trim() || creating}
            className="rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-500 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40 transition shrink-0"
          >
            {creating ? "Creando..." : "Crear"}
          </button>
        </div>
      </div>

      {/* List */}
      {projects.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <div className="text-4xl mb-3">📁</div>
          <div>No tienes proyectos aún.</div>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <a
              key={p.id}
              href={`/projects/${p.id}`}
              className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 hover:border-indigo-500/40 transition group"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{p.name}</h3>
                <span className="text-xs text-indigo-400 opacity-0 group-hover:opacity-100 transition">Abrir →</span>
              </div>
              <p className="text-xs text-slate-500 mt-2 truncate">{p.repo_url ?? "Sin repo"}</p>
              <p className="text-xs text-slate-600 mt-1">{new Date(p.created_at).toLocaleDateString()}</p>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
