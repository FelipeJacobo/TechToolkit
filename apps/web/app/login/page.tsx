"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "../../lib/store";
import { login, register } from "../../lib/api";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  const setAuth = useAppStore((s) => s.setAuth);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "register") {
        const result = await register(email, password);
        if (result.error) { setError(result.error); setLoading(false); return; }
      }
      const data = await login(email, password);
      if (data.error) { setError(data.error); setLoading(false); return; }
      setAuth({ id: data.id ?? "", email, accessToken: data.accessToken, refreshToken: data.refreshToken });
      router.push("/dashboard");
    } catch {
      setError("Error de conexión");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold">Inicia sesión</h1>
          <p className="text-slate-400 mt-1 text-sm">AI Dev Assistant — Agente de desarrollo con trazabilidad</p>
        </div>
        {error && <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">{error}</div>}
        <form onSubmit={handleSubmit} className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Email</label>
            <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="tu@email.com" required className="w-full rounded-lg bg-slate-950 border border-slate-800 p-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Contraseña</label>
            <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="••••••••" required minLength={8} className="w-full rounded-lg bg-slate-950 border border-slate-800 p-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50" />
          </div>
          <button type="submit" disabled={loading} className="w-full rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40 transition">{loading ? (mode === "register" ? "Creando..." : "Iniciando...") : (mode === "register" ? "Crear cuenta" : "Iniciar sesión")}</button>
          <div className="text-center text-sm text-slate-400">
            {mode === "login" ? (
              <>¿No tienes cuenta? <button type="button" onClick={() => setMode("register")} className="text-indigo-400 hover:text-indigo-300 font-medium">Regístrate</button></>
            ) : (
              <>¿Ya tienes cuenta? <button type="button" onClick={() => setMode("login")} className="text-indigo-400 hover:text-indigo-300 font-medium">Inicia sesión</button></>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
