"use client";
import Editor from "@monaco-editor/react";

export default function MonacoEditor() {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <h3 className="text-sm font-semibold">Workspace</h3>
      <div className="mt-3">
        <Editor height="300px" defaultLanguage="typescript" defaultValue="// code..." theme="vs-dark" />
      </div>
    </div>
  );
}
