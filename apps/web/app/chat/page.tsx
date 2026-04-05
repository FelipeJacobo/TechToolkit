"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "../../lib/store";
import { runTask, listProjects } from "../../lib/api";

type ChatMessage = {
  role: "user" | "agent" | "system" | "event";
  content: string;
  timestamp: string;
};

const STATUS_LABELS: Record<string, string> = {
  planning: "🧠 Planificando...",
  plan_created: "📋 Plan creado",
  executing: "⚙️ Ejecutando...",
  execution_completed: "✅ Ejecución completada",
  execution_failed: "❌ Falló en ejecución",
  reviewing: "🔍 Revisando resultado...",
  replanning: "🔄 Replanificando...",
  replan_decided: "♻️ Replan decidida",
  completed: "🎉 Tarea completada",
  failed: "💥 Tarea fallida",
  plan_failed: "❌ Plan fallido",
  run_created: "🚀 Run creado",
};

export default function ChatPage() {
  const router = useRouter();
  const auth = useAppStore((s) => s.auth);
  const token = useAppStore((s) => s.auth?.accessToken);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedProject, setSelectedProject] = useState("");
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const checkRef = useRef<string | null>(null);

  useEffect(() => {
    if (!auth) { router.push("/login"); return; }
    if (!token) return;
    listProjects(token).then((data) => {
      const projectsData = data ?? [];
      setProjects(projectsData);
      if (projectsData.length > 0 && !selectedProject) {
        setSelectedProject(projectsData[0].id);
      }
    });
  }, [auth, token]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Connect to event stream when running
  useEffect(() => {
    if (!running || !token || !runId) return;

    // Use SSE to listen for events
    const es = new EventSource(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081"}/events`);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        const state = data.payload?.state || data.state;
        if (state && STATUS_LABELS[state]) {
          setMessages((prev) => [
            ...prev,
            {
              role: "event",
              content: STATUS_LABELS[state] || state,
              timestamp: new Date().toISOString(),
            },
          ]);
        }
        // Check if this run is complete
        if (state === "completed" || state === "failed") {
          const planResult = data.payload?.planResult as { status?: string } | undefined;
          const finalStatus = state === "completed" ? "completed" : "failed";
          
          setMessages((prev) => [
            ...prev,
            {
              role: finalStatus === "completed" ? "agent" : "system",
              content: finalStatus === "completed"
                ? `✅ ¡Tarea completada!\n\nResultado: ${planResult?.status || "Sin detalles"}`
                : `❌ La tarea falló. Revisa los logs para más detalles.`,
              timestamp: new Date().toISOString(),
            },
          ]);
          
          setRunning(false);
          setLoading(false);
          setRunId(null);
          es.close();
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      // Connection error — try again with poll fallback
      es.close();
      pollForCompletion();
    };

    return () => {
      es.close();
    };
  }, [running, token, runId]);

  const pollForCompletion = () => {
    if (!runId || !token) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081"}/runs/${runId}/logs`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const logs = await res.json();
        // Check last log for completion
        if (logs.length > 0) {
          const lastLog = logs[logs.length - 1];
          if (lastLog.message?.includes("completed") || lastLog.message?.includes("failed")) {
            clearInterval(interval);
            setRunning(false);
            setLoading(false);
            setMessages((prev) => [
              ...prev,
              {
                role: lastLog.level === "error" ? "system" : "agent",
                content: lastLog.message,
                timestamp: lastLog.created_at,
              },
            ]);
            setRunId(null);
          }
        }
      } catch {
        clearInterval(interval);
      }
    }, 3000);
  };

  const handleSend = async () => {
    if (!token || !selectedProject || !input.trim() || loading) return;
    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [
      ...prev,
      { role: "user", content: userMessage, timestamp: new Date().toISOString() },
    ]);
    setLoading(true);
    setRunning(true);

    try {
      const result = await runTask(token, selectedProject, userMessage);
      setRunId(result.runId);
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: `🚀 Tarea enviada — Run ID: ${result.runId?.slice(0, 8) || "..."}`,
          timestamp: new Date().toISOString(),
        },
        { role: "event", content: STATUS_LABELS["planning"], timestamp: new Date().toISOString() },
      ]);
      checkRef.current = result.traceId;
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { role: "system", content: `⚠️ Error: ${err.message || "Error desconocido"}`, timestamp: new Date().toISOString() },
      ]);
      setLoading(false);
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Chat</h1>
          <p className="text-sm text-slate-400 mt-0.5">Envía tareas al agente de desarrollo</p>
        </div>
        <div className="flex items-center gap-3">
          {projects.length > 1 && (
            <select
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              className="rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
          {running && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20">
              <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
              <span className="text-xs text-indigo-400">Ejecutando</span>
            </div>
          )}
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-4xl mb-3">📁</div>
            <p className="text-slate-400">Necesitas un proyecto para empezar.</p>
            <a href="/projects" className="inline-block mt-3 text-indigo-400 text-sm hover:text-indigo-300">
              Crear proyecto →
            </a>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="flex-1 flex items-center justify-center py-16">
                <div className="text-center text-slate-500">
                  <div className="text-5xl mb-4">💬</div>
                  <h3 className="text-lg font-semibold text-slate-400 mb-2">Envía una tarea al agente</h3>
                  <p className="text-sm max-w-sm mx-auto">
                    Pídele que analice código, resuelva bugs, refactorice módulos o genere reportes.
                  </p>
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex animate-fade-in ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-2xl px-4 py-2.5 rounded-xl text-sm whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-indigo-600 text-white"
                      : msg.role === "agent"
                      ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300"
                      : msg.role === "event"
                      ? "bg-slate-800/60 text-slate-400 text-xs"
                      : "bg-red-500/10 border border-red-500/20 text-red-300"
                  }`}
                >
                  {msg.content}
                  <div className={`text-xs mt-1 ${msg.role === "user" ? "text-indigo-200" : "text-slate-500"}`}>
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          {/* Input */}
          <div className="border-t border-slate-800 p-4">
            <div className="flex gap-3">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Describe la tarea..."
                className="flex-1 rounded-lg bg-slate-950 border border-slate-800 p-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-none"
                rows={2}
                disabled={loading || running}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || loading}
                className="self-end rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-500 px-5 py-3 text-sm font-semibold text-white disabled:opacity-40 transition hover:from-indigo-500 hover:to-indigo-400"
              >
                ▶
              </button>
            </div>
            <p className="text-xs text-slate-600 mt-2">Ctrl/⌘ + Enter para enviar</p>
          </div>
        </div>
      )}
    </div>
  );
}
