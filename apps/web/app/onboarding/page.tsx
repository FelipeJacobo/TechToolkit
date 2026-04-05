"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "../../lib/store";
import { useOnboardingStore } from "../../lib/onboarding";
import { listProjects, createProject, uploadFile, runTask } from "../../lib/api";

// ============================================================
// Step 0: Welcome
// ============================================================

function WelcomeStep() {
  const next = useOnboardingStore((s) => s.next);

  return (
    <div className="space-y-6">
      <div className="text-center py-8">
        <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto mb-5">
          <span className="text-2xl">⚡</span>
        </div>
        <h2 className="text-2xl font-semibold tracking-tight">Welcome to AI Dev Assistant</h2>
        <p className="text-slate-400 mt-2 max-w-sm mx-auto text-sm leading-relaxed">
          Set up your first project and run an agent in under 2 minutes.
          We&apos;ll walk you through it step by step.
        </p>
      </div>
      <div className="rounded-lg bg-slate-900/50 border border-slate-800 p-5 space-y-3">
        {[
          { icon: "📁", title: "Create a project", desc: "Name it anything" },
          { icon: "📂", title: "Upload code", desc: "Files or repo URL" },
          { icon: "▶", title: "Run your first task", desc: "See AI in action" },
        ].map((item, i) => (
          <div key={i} className="flex items-center gap-3 text-sm">
            <span className="text-base">{item.icon}</span>
            <span className="text-slate-300">{item.title}</span>
            <span className="text-slate-600 text-xs">·</span>
            <span className="text-slate-500 text-xs">{item.desc}</span>
          </div>
        ))}
      </div>
      <button onClick={next} className="w-full rounded-lg bg-white text-black font-medium text-sm py-2.5 hover:bg-[#f5f5f5] transition">
        Let&apos;s go →
      </button>
    </div>
  );
}

// ============================================================
// Step 1: Create Project
// ============================================================

function CreateProjectStep() {
  const next = useOnboardingStore((s) => s.next);
  const prev = useOnboardingStore((s) => s.prev);
  const projectName = useOnboardingStore((s) => s.projectName);
  const repoUrl = useOnboardingStore((s) => s.repoUrl);
  const setProjectName = useOnboardingStore((s) => s.setProjectName);
  const setRepoUrl = useOnboardingStore((s) => s.setRepoUrl);
  const setProjectId = useOnboardingStore((s) => s.setProjectId);
  const token = useAppStore((s) => s.auth?.accessToken);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [nameError, setNameError] = useState("");
  const [urlError, setUrlError] = useState("");

  const validateName = (v: string) => {
    if (!v.trim()) setNameError("Project name is required");
    else if (v.length < 2) setNameError("At least 2 characters");
    else setNameError("");
  };

  const validateUrl = (v: string) => {
    if (v && !v.match(/^https?:\/\/.+/)) setUrlError("Enter a valid URL (https://...)");
    else setUrlError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    validateName(projectName);
    if (!projectName.trim()) return;
    validateUrl(repoUrl);
    if (repoUrl && urlError) return;

    setLoading(true);
    setError("");

    try {
      const result = await createProject(token, projectName.trim(), repoUrl.trim() || undefined);
      if (result.error) {
        setError(result.error);
        return;
      }
      setProjectId(result.id);
      next();
    } catch {
      setError("Failed to create project");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Create your project</h2>
        <p className="text-sm text-slate-400 mt-1">Give it a name and optionally connect a repo.</p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">
            Project name <span className="text-red-400">*</span>
          </label>
          <input
            value={projectName}
            onChange={(e) => { setProjectName(e.target.value); validateName(e.target.value); }}
            placeholder="e.g. my-api"
            className={`w-full rounded-lg bg-slate-950 border p-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 ${
              nameError ? "border-red-500/50" : "border-slate-800"
            }`}
            autoFocus
            maxLength={100}
          />
          {nameError && <p className="text-xs text-red-400 mt-1">{nameError}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">
            Repo URL <span className="text-slate-600">(optional)</span>
          </label>
          <input
            value={repoUrl}
            onChange={(e) => { setRepoUrl(e.target.value); validateUrl(e.target.value); }}
            placeholder="https://github.com/username/repo"
            className={`w-full rounded-lg bg-slate-950 border p-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 ${
              urlError ? "border-red-500/50" : "border-slate-800"
            }`}
          />
          {urlError && <p className="text-xs text-red-400 mt-1">{urlError}</p>}
        </div>

        {/* Quick start templates */}
        {!projectName && (
          <div className="flex flex-wrap gap-2">
            {[
              { name: "REST API", repo: "" },
              { name: "Web App", repo: "" },
              { name: "CLI Tool", repo: "" },
            ].map((t) => (
              <button
                key={t.name}
                type="button"
                onClick={() => { setProjectName(t.name); validateName(t.name); }}
                className="text-xs px-3 py-1.5 rounded-md bg-slate-800/50 text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition border border-slate-800"
              >
                {t.name}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <button type="button" onClick={prev} className="text-sm text-slate-500 hover:text-slate-300 transition">
            ← Back
          </button>
          <button
            type="submit"
            disabled={!projectName.trim() || loading}
            className="rounded-lg bg-white text-black font-medium text-sm px-5 py-2.5 hover:bg-[#f5f5f5] disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {loading ? "Creating..." : "Next →"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ============================================================
// Step 2: Upload Files
// ============================================================

function UploadStep() {
  const next = useOnboardingStore((s) => s.next);
  const prev = useOnboardingStore((s) => s.prev);
  const uploadedFiles = useOnboardingStore((s) => s.uploadedFiles);
  const addFile = useOnboardingStore((s) => s.addFile);
  const repoUrl = useOnboardingStore((s) => s.repoUrl);
  const token = useAppStore((s) => s.auth?.accessToken);
  const projectId = useOnboardingStore((s) => s.projectId);

  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | File[]) => {
    if (!token || !projectId) return;
    setUploading(true);

    for (const file of Array.from(files)) {
      if (file.size > 1024 * 1024) continue; // skip > 1MB
      addFile({ name: file.name, size: file.size });

      try {
        await import("../../lib/api").then(({ uploadFile }) =>
          uploadFile(token, projectId, file, (p) => setProgress((prev) => ({ ...prev, [file.name]: p })))
        );
      } catch {
        // ignore upload failures for onboarding
      }
    }
    setUploading(false);
    setProgress({});
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  };

  const handleSkip = async () => {
    next();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Upload code</h2>
        <p className="text-sm text-slate-400 mt-1">
          {repoUrl
            ? `Repo connected: ${repoUrl}. You can also upload individual files.`
            : "Drop files here, or skip if you connected a repo URL."}
        </p>
      </div>

      {/* Drop zone */}
      <div
        className={`rounded-xl border-2 border-dashed p-8 text-center transition ${
          dragOver
            ? "border-indigo-500/50 bg-indigo-500/5"
            : "border-slate-800 hover:border-slate-700"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <div className="text-3xl mb-2">📂</div>
        <p className="text-sm text-slate-300 mb-1">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-indigo-400 hover:text-indigo-300 font-medium"
          >
            Browse files
          </button>{" "}
          or drag & drop
        </p>
        <p className="text-xs text-slate-600">.ts, .js, .py, .go, .rs — up to 1MB per file</p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.rb,.php,.css,.html,.json,.yaml,.yml,.md,.sql"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) {
              handleFiles(e.target.files);
              e.target.value = "";
            }
          }}
        />
      </div>

      {/* Uploaded files */}
      {uploadedFiles.length > 0 && (
        <div className="space-y-2">
          {uploadedFiles.map((f, i) => (
            <div key={i} className="flex items-center justify-between bg-slate-950/50 rounded-lg px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-emerald-400">✓</span>
                <span className="text-slate-300">{f.name}</span>
                <span className="text-slate-600">({(f.size / 1024).toFixed(1)} KB)</span>
              </div>
              {progress[f.name] !== undefined && progress[f.name] < 100 && (
                <div className="w-20 bg-slate-800 rounded-full h-1.5">
                  <div className="bg-indigo-500 h-1.5 rounded-full transition-all" style={{ width: `${progress[f.name]}%` }} />
                </div>
              )}
              {progress[f.name] === 100 && <span className="text-emerald-400 text-[10px]">done</span>}
            </div>
          ))}
        </div>
      )}

      {uploading && <p className="text-xs text-indigo-400 animate-pulse">Uploading files...</p>}

      <div className="flex items-center justify-between pt-2">
        <button onClick={prev} className="text-sm text-slate-500 hover:text-slate-300 transition">
          ← Back
        </button>
        <button
          onClick={handleSkip}
          className="rounded-lg bg-white text-black font-medium text-sm px-5 py-2.5 hover:bg-[#f5f5f5] transition"
        >
          {uploadedFiles.length > 0 ? "Next →" : "Skip →"}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Step 3: First Run
// ============================================================

function FirstRunStep() {
  const complete = useOnboardingStore((s) => s.complete);
  const prev = useOnboardingStore((s) => s.prev);
  const runGoal = useOnboardingStore((s) => s.runGoal);
  const setRunGoal = useOnboardingStore((s) => s.setRunGoal);
  const projectId = useOnboardingStore((s) => s.projectId);
  const projectName = useOnboardingStore((s) => s.projectName);
  const token = useAppStore((s) => s.auth?.accessToken);

  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<"idle" | "queued" | "running" | "completed" | "failed">("idle");
  const [events, setEvents] = useState<string[]>([]);
  const [error, setError] = useState("");
  const esRef = useRef<EventSource | null>(null);

  const examples = [
    { label: "🔍 Find bugs", goal: "Analyze the codebase and find all bugs" },
    { label: "📝 Generate tests", goal: "Generate test cases for the main module" },
    { label: "👔 Code review", goal: "Review the code and suggest improvements" },
    { label: "📊 Architecture", goal: "Analyze the project structure and suggest improvements" },
  ];

  const handleFirstRun = async (goal: string) => {
    if (!token || !projectId) return;
    setRunGoal(goal);
    setLoading(true);
    setError("");
    setEvents([]);
    setStatus("queued");

    try {
      const result = await runTask(token, projectId, goal);

      setStatus("running");
      setEvents((prev) => [...prev, `⚡ Task sent — run: ${result.runId?.slice(0, 8)}...`]);

      // Poll for status
      let attempts = 0;
      const interval = setInterval(async () => {
        attempts++;
        try {
          const res = await fetch(
            `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081"}/runs/${result.runId}/logs`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (!res.ok) {
            if (attempts > 30) { clearInterval(interval); setStatus("failed"); setLoading(false); }
            return;
          }
          const logs = await res.json();

          // Update events from logs
          const newEvents = logs.map((l: any) => {
            if (l.message?.includes("planning")) return "🧠 Planning...";
            if (l.message?.includes("running")) return "⚙️ Executing...";
            if (l.message?.includes("completed")) return "✅ Completed!";
            if (l.message?.includes("failed") || l.level === "error") return `❌ ${l.message}`;
            return null;
          }).filter(Boolean);

          if (newEvents.length > 0) {
            setEvents(newEvents as string[]);
          }

          if (logs.some((l: any) => l.message?.includes("completed"))) {
            setStatus("completed");
            clearInterval(interval);
            setLoading(false);
          } else if (logs.some((l: any) => l.message?.includes("failed") || l.level === "error")) {
            setStatus("failed");
            clearInterval(interval);
            setLoading(false);
          } else if (attempts > 30) {
            setStatus("running");
            clearInterval(interval);
            setLoading(false);
          }
        } catch {
          clearInterval(interval);
          setLoading(false);
        }
      }, 2000);

      esRef.current = new EventSource(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081"}/events/stream`
      );
      esRef.current.onmessage = (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          if (data.runId === result.runId) {
            setEvents((prev) => [...prev, data.message ?? JSON.stringify(data).slice(0, 80)]);
          }
        } catch {/* noop */}
      };
    } catch {
      setError("Failed to start run");
      setStatus("failed");
      setLoading(false);
    }
  };

  const handleComplete = () => {
    esRef.current?.close();
    complete();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Run your first task</h2>
        <p className="text-sm text-slate-400 mt-1">
          Choose a task or write your own. The agent will analyze your project.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Quick tasks */}
      {!running && status === "idle" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {examples.map((ex) => (
              <button
                key={ex.label}
                onClick={() => handleFirstRun(ex.goal)}
                disabled={loading}
                className="text-left rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-xs text-slate-300 hover:border-slate-700 hover:bg-slate-800/50 transition disabled:opacity-40"
              >
                {ex.label}
              </button>
            ))}
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-800" /></div>
            <div className="relative flex justify-center"><span className="text-xs text-slate-600 bg-[#09090b] px-3">or write your own</span></div>
          </div>

          <div>
            <textarea
              value={runGoal}
              onChange={(e) => setRunGoal(e.target.value)}
              placeholder="e.g. Analyze src/api and find potential issues"
              className="w-full rounded-lg bg-slate-950 border border-slate-800 p-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-none"
              rows={3}
            />
            <div className="flex items-center justify-between mt-2">
              <button onClick={prev} className="text-sm text-slate-500 hover:text-slate-300 transition">
                ← Back
              </button>
              <button
                onClick={() => handleFirstRun(runGoal)}
                disabled={!runGoal.trim() || loading}
                className="rounded-lg bg-white text-black font-medium text-sm px-5 py-2.5 hover:bg-[#f5f5f5] disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                {loading ? "Starting..." : "Run agent ▶"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Running / completed */}
      {(running || status !== "idle") && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-5">
          <div className="flex items-center gap-2 mb-4">
            {status === "completed" && <span className="text-emerald-400 text-sm font-medium">✅ Completed</span>}
            {status === "failed" && <span className="text-red-400 text-sm font-medium">❌ Failed</span>}
            {status === "running" && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                <span className="text-sm text-indigo-400">Running...</span>
              </div>
            )}
            {status === "queued" && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-sm text-amber-400">Queued...</span>
              </div>
            )}
          </div>
          {events.length > 0 && (
            <div className="space-y-1.5 font-mono text-xs text-slate-400">
              {events.map((e, i) => (
                <div key={i} className="animate-fade-in">{e}</div>
              ))}
            </div>
          )}
          <div className="mt-4 flex items-center justify-end">
            <button
              onClick={handleComplete}
              className="rounded-lg bg-white text-black font-medium text-sm px-5 py-2 hover:bg-[#f5f5f5] transition"
            >
              Done →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Complete!
// ============================================================

function CompleteStep() {
  const runGoal = useOnboardingStore((s) => s.runGoal);
  const projectName = useOnboardingStore((s) => s.projectName);
  const runId = useOnboardingStore((s) => s.runId);
  const reset = useOnboardingStore((s) => s.reset);

  return (
    <div className="space-y-6 py-8">
      <div className="text-center">
        <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-5">
          <span className="text-3xl">🎉</span>
        </div>
        <h2 className="text-2xl font-semibold tracking-tight">All done!</h2>
        <p className="text-sm text-slate-400 mt-2">
          Your agent just ran its first task on <span className="text-slate-200">{projectName}</span>.
        </p>
      </div>

      <div className="rounded-lg bg-slate-900/50 border border-slate-800 p-5 space-y-3 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-500">Task</span>
          <span className="text-slate-300 truncate ml-4 max-w-xs">{runGoal}</span>
        </div>
        {runId && (
          <div className="flex justify-between">
            <span className="text-slate-500">Run ID</span>
            <span className="text-slate-300 font-mono text-xs">{runId.slice(0, 12)}</span>
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <a
          href="/dashboard"
          className="flex-1 text-center rounded-lg bg-white text-black font-medium text-sm py-2.5 hover:bg-[#f5f5f5] transition"
        >
          Go to Dashboard
        </a>
        <button
          onClick={reset}
          className="rounded-lg border border-slate-800 bg-slate-900/50 text-slate-400 font-medium text-sm px-4 hover:bg-slate-800 transition"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Main Onboarding Layout
// ============================================================

const STEPS = ["Welcome", "Project", "Upload", "Run"];

export default function OnboardingPage() {
  const step = useOnboardingStore((s) => s.step);
  const isCompleted = useOnboardingStore((s) => s.isCompleted);

  return (
    <div className="min-h-screen bg-[#09090b] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Progress */}
        {!isCompleted && step > 0 && (
          <div className="mb-8">
            {/* Progress bar */}
            <div className="h-1 w-full bg-slate-800/50 rounded-full overflow-hidden mb-4">
              <div
                className="h-full bg-white rounded-full transition-all duration-500"
                style={{ width: `${(step / 3) * 100}%` }}
              />
            </div>
            {/* Step indicators */}
            <div className="flex items-center justify-between text-xs text-[#52525b]">
              {STEPS.map((label, i) => (
                <span key={label} className={i <= step ? "text-[#a1a1aa]" : ""}>
                  {i + 1}. {label}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Card */}
        <div className="rounded-xl border border-white/[0.06] bg-[#0c0c0e] p-6 sm:p-8">
          {isCompleted ? (
            <CompleteStep />
          ) : step === 0 ? (
            <WelcomeStep />
          ) : step === 1 ? (
            <CreateProjectStep />
          ) : step === 2 ? (
            <UploadStep />
          ) : (
            <FirstRunStep />
          )}
        </div>

        {/* Footer text */}
        <p className="text-center text-xs text-[#3f3f46] mt-6">
          Takes about 2 minutes · Free plan includes 200 runs/month
        </p>
      </div>
    </div>
  );
}
