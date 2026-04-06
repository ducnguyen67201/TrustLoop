export function Footer() {
  return (
    <footer className="w-full py-12 bg-[#1C1917] text-[#8B7E74] border-t border-[#2A2725]">
      <div className="max-w-6xl mx-auto px-6 md:px-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8 text-xs tracking-widest uppercase">
          <div>TrustLoop &copy; 2026</div>
          <div className="flex gap-6">
            <a
              href="https://github.com/ducnguyen67201/TrustLoop"
              className="hover:text-[#F4F1EE] transition-colors"
            >
              GitHub
            </a>
            <a href="https://x.com" className="hover:text-[#F4F1EE] transition-colors">
              X
            </a>
            <a href="mailto:hello@trustloop.dev" className="hover:text-[#F4F1EE] transition-colors">
              Contact
            </a>
          </div>
          <div>Toronto, ON</div>
        </div>
      </div>
    </footer>
  );
}
