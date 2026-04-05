"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "../../lib/store";
import { acceptInvite } from "../../lib/api";

export default function InvitesPage() {
  const router = useRouter();
  const auth = useAppStore((s) => s.auth);
  const token = useAppStore((s) => s.auth?.accessToken);
  const [inviteToken, setInviteToken] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState("");

  const handleAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !inviteToken) return;
    setError("");
    try {
      const data = await acceptInvite(token, inviteToken);
      if (data.error) {
        setError(data.error);
      } else {
        setResult(data.projectId ? `¡Te uniste al proyecto!` : "Invitación aceptada");
      }
    } catch {
      setError("Error accepting invite");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Invitaciones</h1>
        <p className="text-sm text-slate-400 mt-1">Acepta una invitación a un proyecto</p>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 max-w-lg">
        {error && (
          <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">{error}</div>
        )}
        {result && (
          <div className="mb-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 text-sm text-emerald-400">{result}</div>
        )}
        <form onSubmit={handleAccept} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Token de invitación</label>
            <input
              value={inviteToken}
              onChange={(e) => setInviteToken(e.target.value)}
              placeholder="inv_xxx"
              className="w-full rounded-lg bg-slate-950 border border-slate-800 p-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              required
              autoFocus
            />
          </div>
          <button
            type="submit"
            disabled={!inviteToken}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40 transition"
          >
            Aceptar invitación
          </button>
        </form>
      </div>
    </div>
  );
}
