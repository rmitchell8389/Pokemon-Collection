// A small inline Pokéball mark used as DexMate's logo, in the header and on
// the homepage hero. Fixed brand colors rather than currentColor — a
// Pokéball is red/white/black regardless of light or dark mode, same as any
// static logo mark would be.
export function PokeballMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <defs>
        <clipPath id="pokeball-top-half">
          <rect x="0" y="0" width="40" height="18" />
        </clipPath>
        <clipPath id="pokeball-bottom-half">
          <rect x="0" y="22" width="40" height="18" />
        </clipPath>
      </defs>
      <circle cx="20" cy="20" r="18" fill="#E3350D" clipPath="url(#pokeball-top-half)" />
      <circle cx="20" cy="20" r="18" fill="#F4F4F5" clipPath="url(#pokeball-bottom-half)" />
      <rect x="1" y="18" width="38" height="4" fill="#18181B" />
      <circle cx="20" cy="20" r="18" fill="none" stroke="#18181B" strokeWidth="2" />
      <circle cx="20" cy="20" r="6.5" fill="#F4F4F5" stroke="#18181B" strokeWidth="2" />
      <circle cx="20" cy="20" r="2.5" fill="#F4F4F5" stroke="#18181B" strokeWidth="1.5" />
    </svg>
  );
}
