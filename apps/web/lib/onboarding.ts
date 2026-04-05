/**
 * Onboarding state management
 */
import { create } from "zustand";

export type OnboardingStep = 0 | 1 | 2 | 3;

export type OnboardingState = {
  step: OnboardingStep;
  projectId: string | null;
  projectName: string;
  repoUrl: string;
  uploadedFiles: Array<{ name: string; size: number }>;
  runGoal: string;
  runId: string | null;
  isRunning: boolean;
  isCompleted: boolean;

  // Actions
  setStep: (step: OnboardingStep) => void;
  next: () => void;
  prev: () => void;
  setProjectId: (id: string) => void;
  setProjectName: (name: string) => void;
  setRepoUrl: (url: string) => void;
  addFile: (file: { name: string; size: number }) => void;
  clearFiles: () => void;
  setRunGoal: (goal: string) => void;
  setRunId: (id: string) => void;
  setRunning: (v: boolean) => void;
  complete: () => void;
  reset: () => void;
};

const STORAGE_KEY = "aiclaw_onboarding";

function loadState(): Partial<OnboardingState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveState(state: Partial<OnboardingState>) {
  try {
    const existing = loadState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...existing, ...state }));
  } catch {/* noop */}
}

export const useOnboardingStore = create<OnboardingState>((set, get) => {
  const saved = loadState();

  return {
    step: (saved.step ?? 0) as OnboardingStep,
    projectId: saved.projectId ?? null,
    projectName: saved.projectName ?? "",
    repoUrl: saved.repoUrl ?? "",
    uploadedFiles: saved.uploadedFiles ?? [],
    runGoal: saved.runGoal ?? "",
    runId: saved.runId ?? null,
    isRunning: saved.isRunning ?? false,
    isCompleted: saved.isCompleted ?? false,

    setStep: (step) => { set({ step }); saveState({ step }); },
    next: () => {
      const next = Math.min(get().step + 1, 3) as OnboardingStep;
      set({ step: next });
      saveState({ step: next });
    },
    prev: () => {
      const prev = Math.max(get().step - 1, 0) as OnboardingStep;
      set({ step: prev });
      saveState({ step: prev });
    },
    setProjectId: (projectId) => { set({ projectId }); saveState({ projectId }); },
    setProjectName: (projectName) => { set({ projectName }); saveState({ projectName }); },
    setRepoUrl: (repoUrl) => { set({ repoUrl }); saveState({ repoUrl }); },
    addFile: (file) => {
      const files = [...get().uploadedFiles, file];
      set({ uploadedFiles: files });
      saveState({ uploadedFiles: files });
    },
    clearFiles: () => { set({ uploadedFiles: [] }); saveState({ uploadedFiles: [] }); },
    setRunGoal: (runGoal) => { set({ runGoal }); saveState({ runGoal }); },
    setRunId: (runId) => { set({ runId }); saveState({ runId }); },
    setRunning: (isRunning) => set({ isRunning }),
    complete: () => {
      set({ isCompleted: true, step: 3 });
      try { localStorage.removeItem(STORAGE_KEY); } catch {/* noop */}
    },
    reset: () => {
      try { localStorage.removeItem(STORAGE_KEY); } catch {/* noop */}
      set({
        step: 0, projectId: null, projectName: "", repoUrl: "",
        uploadedFiles: [], runGoal: "", runId: null,
        isRunning: false, isCompleted: false,
      });
    },
  };
});
