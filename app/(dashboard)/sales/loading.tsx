// Shown while a Sales page is loading on the server.
export default function SalesLoading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-56 rounded-lg bg-sand-200" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-sand-100" />
        ))}
      </div>
      <div className="h-64 rounded-xl bg-sand-100" />
    </div>
  );
}
