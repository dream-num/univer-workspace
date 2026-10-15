/** Existing tab content keeps its own page container. */
export function PageContent({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background">
      <div className="mx-auto max-w-6xl px-6 py-6 max-[720px]:px-4 max-[720px]:py-4">
        {children}
      </div>
    </div>
  );
}
