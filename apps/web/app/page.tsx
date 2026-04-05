"use client";
import HeroSection from "../components/HeroSection";
import LogosSection from "../components/LogosSection";
import FeaturesSection from "../components/FeaturesSection";
import HowItWorksSection from "../components/HowItWorksSection";
import PricingSection from "../components/PricingSection";
import CTASection from "../components/CTASection";
import Footer from "../components/Footer";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#09090b] text-white antialiased">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#09090b]/80 backdrop-blur-xl border-b border-white/[0.06]">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
              <span className="text-lg">⚡</span>
            </div>
            <span className="font-semibold text-[15px] tracking-tight">AI Dev Assistant</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-[#a1a1aa]">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
            <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
            <a href="/login" className="text-white/70 hover:text-white transition-colors">Sign in</a>
            <a
              href="/dashboard"
              className="bg-white text-black px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#f5f5f5] transition-colors"
            >
              Get Started
            </a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <HeroSection />

      {/* Logos */}
      <LogosSection />

      {/* Features */}
      <FeaturesSection />

      {/* How it works */}
      <HowItWorksSection />

      {/* Pricing */}
      <PricingSection />

      {/* CTA */}
      <CTASection />

      {/* Footer */}
      <Footer />
    </div>
  );
}
