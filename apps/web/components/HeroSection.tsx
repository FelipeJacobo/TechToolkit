"use client";

export default function HeroSection() {
  return (
    <section className="relative pt-32 pb-24 px-6">
      {/* Gradient glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-indigo-500/10 rounded-full blur-[120px]" />
      </div>

      <div className="relative max-w-4xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 bg-white/[0.04] border border-white/[0.08] rounded-full px-4 py-1.5 text-xs text-[#a1a1aa] mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Now with multi-agent orchestration + audit logs
        </div>

        <h1 className="text-[42px] sm:text-[64px] font-semibold tracking-tight leading-[1.06]">
          Dev agents that deliver
          <br />
          <span className="text-[#71717a]">production-ready code.</span>
        </h1>

        <p className="mt-6 text-lg sm:text-xl text-[#a1a1aa] max-w-2xl mx-auto leading-relaxed">
          Automate debugging, code review, and refactoring with AI agents. 
          Multi-tenant, auditable, with real-time cost tracking. Built for teams that ship.
        </p>

        <div className="mt-10 flex items-center justify-center gap-4">
          <a
            href="/register"
            className="bg-white text-black px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-[#f5f5f5] transition-colors"
          >
            Start for free →
          </a>
          <a
            href="#features"
            className="text-sm text-[#a1a1aa] hover:text-white transition-colors"
          >
            See how it works
          </a>
        </div>

        <p className="mt-6 text-xs text-[#52525b]">
          Free plan · 200 runs/mo · No credit card · Setup in 2 min
        </p>
      </div>

      {/* Hero visual */}
      <div className="relative max-w-5xl mx-auto mt-16">
        <div className="rounded-xl border border-white/[0.06] bg-[#0c0c0e] p-6 shadow-2xl shadow-black/50">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 text-xs text-[#71717a]">
              <span>agent:main</span>
              <span>·</span>
              <span className="text-emerald-400">running</span>
            </div>
            <span className="text-xs text-[#52525b]">trace: a7f3d8...</span>
          </div>
          <div className="space-y-3 font-mono text-xs">
            <div className="flex items-center gap-3">
              <span className="text-emerald-400 w-3">●</span>
              <span className="text-[#a1a1aa]">Planning task...</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-emerald-400 w-3">●</span>
              <span className="text-[#a1a1aa]">Analyzing src/api/routes.ts — found 2 vulnerabilities</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-emerald-400 w-3">●</span>
              <span className="text-[#a1a1aa]">Generating fix with isolated-vm sandbox...</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-3 animate-pulse">◌</span>
              <span className="text-[#52525b]">Running tests...</span>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-white/[0.04] flex items-center justify-between text-xs text-[#52525b]">
            <span>Cost: $0.0012 · Tokens: 492</span>
            <span>Duration: 3.2s</span>
          </div>
        </div>
      </div>
    </section>
  );
}
