// Page title block. `eyebrow` is optional and additive, so existing callers
// (title / description / action) render exactly as before, just re-skinned.
export function PageHeader({
  title,
  description,
  action,
  eyebrow,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  eyebrow?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-8 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-2 flex flex-wrap items-center gap-2">{eyebrow}</div>}
        <h1 className="text-[28px] leading-9 sm:text-4xl sm:leading-[44px]">{title}</h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-sm text-sand-600 sm:text-[15px] sm:leading-6">
            {description}
          </p>
        )}
      </div>
      {action && <div className="w-full shrink-0 sm:w-auto">{action}</div>}
    </div>
  );
}
