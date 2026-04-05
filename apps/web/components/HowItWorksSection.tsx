"use client";

const steps = [
  {
    num: "01",
    title: "Create a project",
    description: "Connect a repo or upload code. Give your agent a goal in plain language — \"find the bug in payments\" or \"generate test suite.\"",
  },
  {
    num: "02",
    title: "Agents get to work",
    description: "Planner breaks it down. Executor runs the tools. Critic reviews the output. All streaming live to your dashboard.",
  },
  {
    num: "03",
    title: "Ship with confidence",
    description: "Get structured results with diffs, suggestions, and cost breakdown. Every run is auditable and reproducible.",
  },
];

export default function HowItWorksSection() {
  return (
    <section className="py-24 px-6 border-t border-white/[0.06]">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-semibold text-center tracking-tight">
          Three steps. <span className="text-[#71717a]">Zero friction.</span>
        </h2>
        <div className="mt-16 space-y-12">
          {steps.map((step, i) => (
            <div key={i} className="flex gap-6 md:gap-10">
              <div className="text-sm font-mono text-[#52525b] pt-1 shrink-0">{step.num}</div>
              <div>
                <h3 className="font-medium text-[15px] text-white mb-2">{step.title}</h3>
                <p className="text-sm text-[#71717a] leading-relaxed max-w-lg">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
