import { useAppStore } from "../lib/store";

export default function RunTimeline() {
  const events = useAppStore((s) => s.events);
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <h3 className="text-sm font-semibold">Run Timeline</h3>
      <div className="mt-3 space-y-2 text-xs">
        {events.map((event, idx) => (
          <div key={idx} className="rounded bg-slate-950 p-2">
            <div className="text-slate-400">{event.state}</div>
            <pre className="text-slate-200">{JSON.stringify(event.payload, null, 2)}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}
