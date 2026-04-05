"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "../../../lib/store";
import { listMembers, addMember, updateMember, removeMember, listInvites, createInvite, revokeInvite, listFiles, uploadFile, searchRepo } from "../../../lib/api";

type Params = { params: { id: string } };

export default function ProjectDetailPage({ params }: Params) {
  const router = useRouter();
  const auth = useAppStore((s) => s.auth);
  const token = useAppStore((s) => s.auth?.accessToken);

  const [projectName] = useState(`Project ${params.id}`);
  const [members, setMembers] = useState<Array<{ user_id: string; role: string; created_at: string }>>([]);
  const [files, setFiles] = useState<Array<{ id: string; filename: string; created_at: string }>>([]);
  const [invites, setInvites] = useState<Array<{ id: string; email: string; role: string; expires_at: string }>>([]);
  const [memberId, setMemberId] = useState("");
  const [newRole, setNewRole] = useState("viewer");
  const [inviteEmail, setInviteEmail] = useState("");
  const [upload, setUpload] = useState<File | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ id: string; content: string }>>([]);
  const [activeTab, setActiveTab] = useState<"files" | "members" | "invites">("files");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!auth) { router.push("/login"); return; }
    if (!token) return;
    loadData();
  }, [token, auth]);

  const loadData = async () => {
    if (!token) return;
    try {
      const [m, f, i] = await Promise.all([
        listMembers(token, params.id),
        listFiles(token, params.id),
        listInvites(token, params.id)
      ]);
      setMembers(m ?? []);
      setFiles(f ?? []);
      setInvites(i ?? []);
    } catch {
      setError("Error loading project data");
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async () => {
    if (!token || !upload) return;
    try {
      await uploadFile(token, params.id, upload);
      setUpload(null);
      await loadData();
    } catch {
      setError("Upload failed");
    }
  };

  const handleSearch = async () => {
    if (!token || !query) return;
    const data = await searchRepo(token, params.id, query);
    setResults(data ?? []);
  };

  const handleInvite = async () => {
    if (!token || !inviteEmail) return;
    await createInvite(token, params.id, inviteEmail, "viewer", 7);
    setInviteEmail("");
    await loadData();
  };

  if (loading) return <div className="flex items-center justify-center py-16 text-slate-400">Cargando proyecto...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <a href="/projects" className="text-xs text-slate-500 hover:text-slate-300">← Proyectos</a>
          <h1 className="text-2xl font-bold mt-1">{projectName}</h1>
          <p className="text-sm text-slate-400 mt-1 truncate text-xs font-mono">{params.id}</p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-800">
        {(["files", "members", "invites"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              activeTab === tab
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            {tab === "files" ? "Archivos" : tab === "members" ? "Miembros" : "Invitaciones"}
          </button>
        ))}
      </div>

      {/* Files */}
      {activeTab === "files" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-sm font-semibold mb-3">Subir archivo</h2>
            <div className="flex gap-3 items-center">
              <input
                type="file"
                onChange={(e) => setUpload(e.target.files?.[0] ?? null)}
                className="text-sm text-slate-400"
              />
              <button
                onClick={handleUpload}
                disabled={!upload}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium disabled:opacity-40 transition"
              >
                Subir
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">Archivos ({files.length})</h2>
            </div>
            {files.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-4">Sin archivos</p>
            ) : (
              <div className="space-y-1">
                {files.map((f) => (
                  <div key={f.id} className="flex justify-between px-3 py-2 rounded bg-slate-950/50 text-sm">
                    <span>{f.filename}</span>
                    <span className="text-xs text-slate-500">{new Date(f.created_at).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-sm font-semibold mb-3">Búsqueda semántica</h2>
            <div className="flex gap-3">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar en el repo..."
                className="flex-1 rounded-lg bg-slate-950 border border-slate-800 p-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
              <button onClick={handleSearch} className="rounded-lg bg-slate-800 px-4 py-2.5 text-sm transition hover:bg-slate-700">
                Buscar
              </button>
            </div>
            {results.length > 0 && (
              <div className="mt-3 space-y-2">
                {results.map((r) => (
                  <pre key={r.id} className="text-xs bg-slate-950 p-3 rounded-lg overflow-auto max-h-40 text-slate-300">{r.content}</pre>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Members */}
      {activeTab === "members" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-sm font-semibold mb-3">Agregar miembro</h2>
            <div className="flex gap-3">
              <input
                value={memberId}
                onChange={(e) => setMemberId(e.target.value)}
                placeholder="User ID"
                className="flex-1 rounded-lg bg-slate-950 border border-slate-800 p-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="rounded-lg bg-slate-950 border border-slate-800 p-2.5 text-sm"
              >
                <option value="owner">owner</option>
                <option value="editor">editor</option>
                <option value="viewer">viewer</option>
              </select>
              <button
                onClick={async () => {
                  if (!token || !memberId) return;
                  await addMember(token, params.id, memberId, newRole);
                  setMemberId("");
                  await loadData();
                }}
                className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium"
              >
                Agregar
              </button>
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-sm font-semibold mb-3">Miembros ({members.length})</h2>
            {members.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-4">Sin miembros</p>
            ) : (
              <div className="space-y-2">
                {members.map((m) => (
                  <div key={m.user_id} className="flex items-center justify-between bg-slate-950/50 rounded-lg p-3">
                    <div>
                      <div className="text-sm font-mono">{m.user_id}</div>
                      <div className="text-xs text-slate-500">{new Date(m.created_at).toLocaleDateString()}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={m.role}
                        onChange={async (e) => {
                          if (!token) return;
                          await updateMember(token, params.id, m.user_id, e.target.value);
                          await loadData();
                        }}
                        className="rounded bg-slate-900 p-1 text-xs"
                      >
                        <option value="owner">owner</option>
                        <option value="editor">editor</option>
                        <option value="viewer">viewer</option>
                      </select>
                      <button
                        onClick={async () => {
                          if (!token) return;
                          await removeMember(token, params.id, m.user_id);
                          await loadData();
                        }}
                        className="text-red-400 text-xs hover:text-red-300"
                      >
                        Remover
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Invites */}
      {activeTab === "invites" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-sm font-semibold mb-3">Crear invitación</h2>
            <div className="flex gap-3">
              <input
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="email@ejemplo.com"
                className="flex-1 rounded-lg bg-slate-950 border border-slate-800 p-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
              <button
                onClick={handleInvite}
                disabled={!inviteEmail}
                className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium disabled:opacity-40 transition"
              >
                Invitar
              </button>
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-sm font-semibold mb-3">Invitaciones ({invites.length})</h2>
            {invites.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-4">Sin invitaciones</p>
            ) : (
              <div className="space-y-2">
                {invites.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between bg-slate-950/50 rounded-lg p-3">
                    <div>
                      <div className="text-sm">{inv.email}</div>
                      <div className="text-xs text-slate-500">{inv.role} · expira {new Date(inv.expires_at).toLocaleDateString()}</div>
                    </div>
                    <button
                      onClick={async () => {
                        if (!token) return;
                        await revokeInvite(token, params.id, inv.id);
                        await loadData();
                      }}
                      className="text-red-400 text-xs hover:text-red-300"
                    >
                      Revocar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
