"use client";
import { useState } from "react";

export default function SupportPage() {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Stub: opens email client for now
    window.location.href = `mailto:support@aidev.io?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
    setSent(true);
  };

  if (sent) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="text-4xl mb-3">✅</div>
        <h2 className="text-xl font-semibold mb-2">Ticket enviado</h2>
        <p className="text-sm text-slate-400">Te responderemos lo antes posible.</p>
        <button onClick={() => setSent(false)} className="mt-4 text-indigo-400 text-sm hover:text-indigo-300">Enviar otro</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Soporte</h1>
        <p className="text-sm text-slate-400 mt-1">¿Necesitas ayuda? Escríbenos.</p>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 max-w-xl">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Asunto</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="¿En qué podemos ayudarte?"
              required
              className="w-full rounded-lg bg-slate-950 border border-slate-800 p-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Mensaje</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe tu problema en detalle..."
              required
              rows={5}
              className="w-full rounded-lg bg-slate-950 border border-slate-800 p-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />
          </div>
          <button type="submit" className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 transition">
            Enviar ticket
          </button>
        </form>
        <div className="mt-6 pt-4 border-t border-slate-800 text-xs text-slate-500">
          También puedes escribir a <a href="mailto:support@aidev.io" className="text-indigo-400">support@aidev.io</a>
        </div>
      </div>
    </div>
  );
}
