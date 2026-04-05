"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "../../lib/store";
import { runTask, connectStream } from "../../lib/api";

type ChatMessage = {
  role: "user" | "agent" | "system";
  content: string;
  timestamp: string;
};

export default function ChatPanel() {
  const [goal, setGoal] = useState("");
  const [projectId, setProjectId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [running, setRunning] = useState(false);
  const token = useAppStore((s) => s.auth?.accessToken);
  const messagesEndRef = useState<HTMLDivElement | null>(null);

  const handleRun = async () => {
    if (!token || !projectId || !goal.trim() || running) return;
    setRunning(true);
    const userMsg: ChatMessage = { role: "user", content: goal, timestamp: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const result = await runTask(token, projectId, goal);
      setMessages((prev) => [...prev, { role: "system", content: `▶ Run iniciado: ${result.runId ?? result.traceId ?? ""}`, timestamp: new Date().toISOString() }]);

      // Connect SSE for live events
      connectStream(token, projectId, (data: any) => {
        const labels: Record<string, string> = {
          planning: "🧠  Planificando...",
          plan_created: "📋  Plan creado",
          executing: "⚙️  Ejecutando...",
          execution_completed: "✅  Ejecución completada",
          execution_failed: "❌  Error en ejecución",
          completed: "🎉  Tarea completada",
          failed: "❌  Tarea fallida",
          replanning: "🔄  Replanificando..."
        };
        const label = labels[data.state] ?? `📡  ${data.state}`;
        setMessages((prev) => [...prev, { role: "agent", content: label, timestamp: new Date().toISOString() }]);
        if (data.state === "completed" || data.state === "failed") {
          setRunning(false);
        }
      });
      setGoal("");
    } catch (err: any) {
      setMessages((prev) => [...prev, { role: "system", content: `⚠️  Error: ${err.message}`, timestamp: new Date().toISOString() }]);
      setRunning(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-slate-800 px-5 py-4 flex items-center justify-between shrink-0">
        <div>
          <h2 className="font-semibold">Chat con el Agente</h2>
          <p className="text-xs text-slate-500 mt-0.5">Describe una tarea y el agente la ejecuta</p>
        </div>
        <input
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          placeholder="Project ID"
          className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 w-44"
        />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-5 space-y-3 min-h-[400px] max-h-[520px]">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-slate-500">
            <div className="text-4xl mb-3">💬</div>
            <div className="text-sm">Describe tu tarea de desarrollo para comenzar</div>
            <div className="text-xs text-slate-600 mt-2">Debug · Refactor · Análisis de repo · Tests</div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} animate-fade-in`}>
            <div className={`max-w-md rounded-xl px-4 py-2.5 text-sm ${
              msg.role === "user"
                ? "bg-indigo-600 text-white"
                : msg.role === "system"
                ? "bg-slate-800 text-slate-400 text-xs font-mono"
                : "bg-slate-800/50 text-slate-200"
            }`}>
              {msg.content}
              <div className={`text-[10px] mt-1 ${msg.role === "user" ? "text-indigo-200" : "text-slate-500"}`}>
                {new Date(msg.timestamp).toLocaleTimeString()}
              </div>
            </div>
          </div>
        ))}
        {running && (
          <div className="flex justify-start">
            <div className="bg-slate-800/50 rounded-xl px-4 py-2.5 text-sm text-slate-400 animate-pulse">
              Agente trabajando...
            </div>
          </div>
        )}
        <div ref={messagesEndRef as any} />
      </div>

      {/* Input */}
      <div className="border-t border-slate-800 px-5 py-4 shrink-0">
        <div className="flex gap-2">
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleRun(); } }}
            placeholder="Busca el bug en el build del proyecto..."
            className="flex-1 rounded-lg bg-slate-950 border border-slate-800 p-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-none"
            rows={2}
          />
          <button
            onClick={handleRun}
            disabled={!goal.trim() || !projectId || running}
            className="self-end rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-500 px-5 py-3 text-sm font-semibold text-white disabled:opacity-40 transition hover:from-indigo-500 hover:to-indigo-400 disabled:cursor-not-allowed"
          >
            {running ? "⏳" : "▶"}
          </button>
        </div>
        <div className="text-xs text-slate-600 mt-2">Ctrl+Enter para enviar</div>
      </div>
    </div>
  );
}
