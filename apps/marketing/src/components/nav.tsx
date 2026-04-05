export function Nav() {
  return (
    <nav className="w-full fixed top-0 left-0 right-0 z-50 px-4 md:px-6 pt-4">
      <div className="max-w-6xl mx-auto bg-white/90 backdrop-blur-md border border-[#EAE5E0] rounded-2xl px-6 md:px-8 py-3 flex items-center justify-between">
        {/* Brand */}
        <div className="flex flex-col">
          <span className="text-sm font-semibold tracking-tight text-[#1C1917] uppercase leading-none">
            TrustLoop
          </span>
          <span className="text-[9px] text-[#8B7E74] tracking-widest uppercase leading-none mt-0.5 hidden sm:block">
            Support Operations
          </span>
        </div>

        {/* Links */}
        <div className="hidden md:flex items-center gap-10 text-xs uppercase tracking-widest text-[#8B7E74]">
          <a
            href="#how-it-works"
            className="hover:text-[#1C1917] transition-colors"
          >
            Product
          </a>
          <a href="#" className="hover:text-[#1C1917] transition-colors">
            Features
          </a>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-4 md:gap-6">
          <a
            href="#"
            className="text-xs uppercase tracking-widest text-[#1C1917] hover:text-[#8B7E74] transition-colors hidden sm:block"
          >
            Sign In
          </a>
          <a
            href="#cta"
            className="bg-[#1C1917] text-[#F4F1EE] text-xs uppercase tracking-widest px-5 py-2.5 rounded-xl hover:bg-[#2A2725] transition-colors whitespace-nowrap"
          >
            Get Early Access
          </a>
        </div>
      </div>
    </nav>
  );
}
