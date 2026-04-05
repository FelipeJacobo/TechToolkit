import { create } from "zustand";
import { connectStream } from "../lib/ws";
import type { AuthUser } from "../lib/auth";

type AgentEvent = {
  traceId: string;
  state: string;
  payload: unknown;
  timestamp?: string;
};

type ActiveRun = {
  runId: string;
  goal: string;
  status: string;
  projectId: string;
  events: AgentEvent[];
  ws: WebSocket | null;
};

type AppState = {
  auth: AuthUser | null;
  activeRun: ActiveRun | null;
  setAuth: (user: AuthUser | null) => void;
  startRun: (projectId: string, runId: string, goal: string, token: string) => void;
  addRunEvent: (event: AgentEvent) => void;
  completeRun: (status: string) => void;
  clearRun: () => void;
};

export const useAppStore = create<AppState>((set, get) => ({
  auth: null,
  activeRun: null,
  setAuth: (auth) => {
    if (auth) {
      try { localStorage.setItem("aiclaw_auth", JSON.stringify(auth)); } catch { /* noop */ }
    } else {
      try { localStorage.removeItem("aiclaw_auth"); } catch { /* noop */ }
    }
    set({ auth });
  },
  startRun: (projectId, runId, goal, token) => {
    get().clearRun();
    const activeRun: ActiveRun = { runId, goal, status: "started", projectId, events: [], ws: null };
    try {
      const ws = connectStream(projectId, token, (data: AgentEvent) => {
        get().addRunEvent(data);
        const run = get().activeRun;
        if (run) {
          let status = run.status;
          if (data.state === "completed") status = "completed";
          else if (data.state === "execution_failed" || data.state === "failed") status = "failed";
          set({ activeRun: { ...run, status, events: [...run.events, { ...data, timestamp: new Date().toISOString() }] } });
        }
      });
      activeRun.ws = ws;
    } catch { /* ws not available */ }
    set({ activeRun: { ...activeRun, events: [{ traceId: runId, state: "started", payload: { goal }, timestamp: new Date().toISOString() }] } });
  },
  addRunEvent: (event) => {
    const run = get().activeRun;
    if (!run) return;
    set({ activeRun: { ...run, events: [...run.events, { ...event, timestamp: new Date().toISOString() }] } });
  },
  completeRun: (status) => {
    const run = get().activeRun;
    if (!run) return;
    set({ activeRun: { ...run, status, events: [...run.events, { traceId: run.runId, state: "final", payload: { status }, timestamp: new Date().toISOString() }] } });
  },
  clearRun: () => {
    const run = get().activeRun;
    if (run?.ws) run.ws.close();
    set({ activeRun: null });
  }
}));

// Load auth from localStorage on init
if (typeof window !== "undefined") {
  try {
    const raw = localStorage.getItem("aiclaw_auth");
    if (raw) {
      useAppStore.getState().setAuth(JSON.parse(raw) as AuthUser);
    }
  } catch { /* noop */ }
}
