export const BRAND = "OfficeLab";

export function OfficeLabMark({ className }: { readonly className?: string }) {
  return (
    <svg viewBox="0 0 26 26" aria-hidden="true" className={className}>
      <path
        d="M9 2.5h8M10.6 2.5v7.1L4.3 20.3A2.2 2.2 0 0 0 6.2 23.5h13.6a2.2 2.2 0 0 0 1.9-3.2L15.4 9.6V2.5"
        fill="none"
        stroke="var(--rd-brand)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.2 14h9.6l4 6.3a2.2 2.2 0 0 1-1.9 3.2H6.1a2.2 2.2 0 0 1-1.9-3.2z"
        fill="var(--rd-brand)"
      />
      <path d="M5.6 18.8h14.8M13 14v9.5" stroke="var(--rd-on-brand)" strokeWidth="1.4" />
    </svg>
  );
}
