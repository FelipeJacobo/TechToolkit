const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";
const wsBase = (process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:8081").replace("http", "ws");

// ===== Auth =====
export const register = async (email: string, password: string) => {
  const res = await fetch(`${apiBase}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return res.json();
};

export const login = async (email: string, password: string) => {
  const res = await fetch(`${apiBase}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return res.json();
};

export const logout = async (refreshToken: string) => {
  const res = await fetch(`${apiBase}/auth/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  return res.json();
};

export const refresh = async (refreshToken: string) => {
  const res = await fetch(`${apiBase}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  return res.json();
};

// ===== Helpers =====
const authFetch = async (path: string, options: RequestInit = {}, token: string) => {
  const res = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  return res;
};

// ===== Projects =====
export const listProjects = async (token: string) => {
  const res = await authFetch("/projects", {}, token);
  return res.json();
};

export const createProject = async (token: string, name: string, repoUrl?: string) => {
  const res = await authFetch("/projects", {
    method: "POST",
    body: JSON.stringify({ name, repoUrl }),
  }, token);
  return res.json();
};

// ===== Tasks / Runs =====
export const runTask = async (token: string, projectId: string, goal: string) => {
  const res = await authFetch("/agent/run-task", {
    method: "POST",
    body: JSON.stringify({ projectId, goal }),
  }, token);
  return res.json();
};

export const listRuns = async (token: string) => {
  const res = await authFetch("/runs", {}, token);
  return res.json();
};

export const getRunLogs = async (token: string, runId: string) => {
  const res = await authFetch(`/runs/${runId}/logs`, {}, token);
  return res.json();
};

// ===== Streaming (WebSocket) =====
export const connectStream = (token: string, projectId: string, onEvent: (data: any) => void) => {
  const url = new URL(`${wsBase}/ws/stream`);
  url.searchParams.set("token", token);
  url.searchParams.set("projectId", projectId);
  const ws = new WebSocket(url.toString());
  ws.onmessage = (msg) => onEvent(JSON.parse(msg.data));
  return ws;
};

// ===== Analytics =====
export const getAnalytics = async (token: string) => {
  const res = await authFetch("/analytics/projects", {}, token);
  return res.json();
};

// ===== Billing =====
export const getBillingUsage = async (token: string) => {
  const res = await authFetch("/billing/usage", {}, token);
  return res.json();
};

export const getBillingPlan = async (token: string) => {
  const res = await authFetch("/billing/plan", {}, token);
  return res.json();
};

export const startCheckout = async (token: string) => {
  const res = await authFetch("/billing/checkout", { method: "POST" }, token);
  return res.json();
};

// ===== API Keys =====
export const listApiKeys = async (token: string) => {
  const res = await authFetch("/auth/api-keys", {}, token);
  return res.json();
};

export const createApiKey = async (token: string, projectId?: string, role?: string, expiresInDays?: number) => {
  const res = await authFetch("/auth/api-keys", {
    method: "POST",
    body: JSON.stringify({ projectId, role, expiresInDays }),
  }, token);
  return res.json();
};

export const deleteApiKey = async (token: string, id: string) => {
  const res = await authFetch(`/auth/api-keys/${id}`, { method: "DELETE" }, token);
  return res.json();
};

// ===== Repo =====
export const uploadFile = async (token: string, projectId: string, file: File, onProgress?: (pct: number) => void) => {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${apiBase}/repo/upload?projectId=${projectId}`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    if (onProgress) xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => resolve();
    xhr.onerror = () => reject();
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
};

export const listFiles = async (token: string, projectId: string) => {
  const res = await authFetch(`/repo/files?projectId=${projectId}`, {}, token);
  return res.json();
};

export const searchRepo = async (token: string, projectId: string, query: string) => {
  const res = await authFetch(`/repo/search?projectId=${projectId}&q=${encodeURIComponent(query)}`, {}, token);
  return res.json();
};

// ===== Members =====
export const listMembers = async (token: string, projectId: string) => {
  const res = await authFetch(`/projects/${projectId}/members`, {}, token);
  return res.json();
};

export const addMember = async (token: string, projectId: string, userId: string, role: string) => {
  const res = await authFetch(`/projects/${projectId}/members`, {
    method: "POST",
    body: JSON.stringify({ userId, role }),
  }, token);
  return res.json();
};

export const updateMember = async (token: string, projectId: string, memberId: string, role: string) => {
  const res = await authFetch(`/projects/${projectId}/members/${memberId}`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  }, token);
  return res.json();
};

export const removeMember = async (token: string, projectId: string, memberId: string) => {
  const res = await authFetch(`/projects/${projectId}/members/${memberId}`, { method: "DELETE" }, token);
  return res.json();
};

// ===== Invites =====
export const listInvites = async (token: string, projectId: string) => {
  const res = await authFetch(`/projects/${projectId}/invites`, {}, token);
  return res.json();
};

export const createInvite = async (token: string, projectId: string, email: string, role: string, expiresInDays?: number) => {
  const res = await authFetch(`/projects/${projectId}/invites`, {
    method: "POST",
    body: JSON.stringify({ email, role, expiresInDays }),
  }, token);
  return res.json();
};

export const revokeInvite = async (token: string, projectId: string, inviteId: string) => {
  const res = await authFetch(`/projects/${projectId}/invites/${inviteId}`, { method: "DELETE" }, token);
  return res.json();
};

export const acceptInvite = async (token: string, inviteToken: string) => {
  const res = await authFetch("/projects/invites/accept", {
    method: "POST",
    body: JSON.stringify({ token: inviteToken }),
  }, token);
  return res.json();
};

// ===== Audit =====
export const getAuditLogs = async (token: string) => {
  const res = await authFetch("/audit/logs", {}, token);
  return res.json();
};

export const exportAudit = async (token: string) => {
  const res = await authFetch("/audit/export", {}, token);
  return res.text();
};

// ===== Alerts =====
export const getAlerts = async (token: string) => {
  const res = await authFetch("/runs/alerts", {}, token);
  return res.json();
};

// ===== Admin =====
export const adminRetention = async (adminToken: string) => {
  const res = await fetch(`${apiBase}/admin/retention/run`, {
    method: "POST",
    headers: { "X-Admin-Token": adminToken },
  });
  return res.json();
};

// ===== Trace =====
export const getTrace = async (token: string, traceId: string) => {
  const res = await authFetch(`/trace/${traceId}`, {}, token);
  return res.json();
};
