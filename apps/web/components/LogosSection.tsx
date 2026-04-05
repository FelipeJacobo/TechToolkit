"use client";

const companies = [
  { name: "Vercel", logo: "▲" },
  { name: "Stripe", logo: "◆" },
  { name: "Linear", logo: "●" },
  { name: "Resend", logo: "✦" },
  { name: "Supabase", logo: "◆" },
  { name: "Clerk", logo: "◈" },
];

export default function LogosSection() {
  return (
    <section className="py-16 border-t border-b border-white/[0.06]">
      <p className="text-center text-xs text-[#52525b] mb-8 uppercase tracking-wider">Trusted by engineering teams at</p>
      <div className="max-w-4xl mx-auto flex items-center justify-center gap-8 md:gap-14 flex-wrap px-6">
        {companies.map((c) => (
          <div key={c.name} className="flex items-center gap-2 text-[#3f3f46] hover:text-[#71717a] transition-colors">
            <span className="text-lg">{c.logo}</span>
            <span className="text-xs font-medium">{c.name}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
