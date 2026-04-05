"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "../../lib/store";
import { getBillingUsage, getBillingPlan, startCheckout } from "../../lib/api";

export default function BillingPage() {
  const router = useRouter();
  const auth = useAppStore((s) => s.auth);
  const token = useAppStore((s) => s.auth?.accessToken);
  const [usage, setUsage] = useState<{ usage: number; limit: number; tokens: number; cost: number; month: string } | null>(null);
  const [plan, setPlan] = useState<{ plan_code: string; name: string; monthly_runs_limit: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth) { router.push("/login"); return; }
    if (!token) return;
    Promise.all([getBillingUsage(token), getBillingPlan(token)]).then(([u, p]) => {
      setUsage(u);
      setPlan(p);
      setLoading(false);
    });
  }, [token, auth]);

  const handleUpgrade = async () => {
    if (!token) return;
    const res = await startCheckout(token);
    if (res.url) window.location.href = res.url;
  };

  if (loading) return <div className="flex items-center justify-center py-16 text-slate-400">Cargando facturación...</div>;

  const pct = usage && usage.limit ? Math.min(100, Math.round((usage.usage / usage.limit) * 100)) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Facturación</h1>
        <p className="text-sm text-slate-400 mt-1">Tu plan, uso y gastos</p>
      </div>

      {/* Current Plan */}
      {plan && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Tu plan actual</h2>
            <span className="px-3 py-1 rounded-full text-xs font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">{plan.name}</span>
          </div>
          <div className="text-sm text-slate-300">
            Límite mensual: <span className="font-semibold">{plan.monthly_runs_limit}</span> runs
          </div>
        </div>
      )}

      {/* Usage */}
      {usage && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
          <h2 className="text-lg font-semibold mb-4">Uso del mes ({usage.month})</h2>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-slate-400">Runs usados</span>
                <span className="font-medium">{usage.usage} / {usage.limit}</span>
              </div>
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-indigo-500 to-cyan-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
              <div className="text-xs text-slate-500 mt-1">{pct}% usado</div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg bg-slate-950 p-4">
                <div className="text-2xl font-bold">{usage.tokens.toLocaleString()}</div>
                <div className="text-xs text-slate-400 mt-1">Tokens usados</div>
              </div>
              <div className="rounded-lg bg-slate-950 p-4">
                <div className="text-2xl font-bold text-emerald-400">${usage.cost.toFixed(4)}</div>
                <div className="text-xs text-slate-400 mt-1">Costo</div>
              </div>
            </div>
          </div>
          <button
            onClick={handleUpgrade}
            className="mt-6 rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-500 px-5 py-2.5 text-sm font-semibold text-white hover:from-indigo-500 hover:to-indigo-400 transition"
          >
            Mejorar plan
          </button>
        </div>
      )}
    </div>
  );
}
