import React from 'react';

const features = [
  {
    icon: '🧠',
    title: 'AI Agent Orchestration',
    description: 'Planner, Executor, and Critic agents work together to analyze, execute, and review code changes — not just echo commands.',
  },
  {
    icon: '🔒',
    title: 'Full Audit Trail',
    description: 'Every action is logged, timestamped, and traceable. Export to CSV for compliance or team reviews.',
  },
  {
    icon: '🏢',
    title: 'Multi-Tenant by Design',
    description: 'Isolated projects, role-based access (owner/editor/viewer), and invitation workflows — built for agencies.',
  },
  {
    icon: '⚡',
    title: 'JetStream Reliability',
    description: 'NATS JetStream with automatic retries, dead letter queues, and idempotent event processing.',
  },
  {
    icon: '📊',
    title: 'Real-Time Cost Tracking',
    description: 'See token usage, execution cost, and run metrics per project. Stay within budget with no surprises.',
  },
  {
    icon: '🔌',
    title: 'Developer-First API',
    description: 'REST endpoints, WebSocket streaming, and SSE. Integrate with your CI/CD pipeline in minutes.',
  },
];

const FeaturesSection = () => {
  return (
    <section className="py-24 px-6">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-semibold text-center tracking-tight">
          Everything to automate
          <br />
          <span className="text-[#71717a]">your development workflow.</span>
        </h2>

        <div className="mt-16 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-white/[0.06] rounded-xl border border-white/[0.06] overflow-hidden">
          {features.map((feature, i) => (
            <div key={i} className="bg-[#09090b] p-8 hover:bg-[#0c0c0e] transition-colors group">
              <div className="text-2xl mb-4">{feature.icon}</div>
              <h3 className="font-medium text-[15px] text-white mb-2">{feature.title}</h3>
              <p className="text-sm text-[#71717a] leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;
