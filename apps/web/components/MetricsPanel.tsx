"use client";
import { useEffect, useState } from "react";

export default function MetricsPanel() {
  const [metrics, setMetrics] = useState<string>("");

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const res = await fetch(process.env.NEXT_PUBLIC_METRICS_URL ?? "http://localhost:9464/metrics");
        const text = await res.text();
        setMetrics(text);
      } catch {
        setMetrics("Metrics unavailable");
      }
    };
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <h3 className="text-sm font-semibold">Raw Metrics</h3>
      <pre className="mt-3 max-h-48 overflow-auto text-xs text-slate-300">{metrics}</pre>
    </div>
  );
}
