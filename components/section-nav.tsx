import { splitTitle } from "@/lib/monthly";

// Jump-to-section index. The monthly report runs to 14 sections; without this a
// manager has to scroll blind to find "Housekeeping". Plain anchors, so it works
// with no JavaScript and prints away cleanly.
export function SectionNav({
  sections,
}: {
  sections: { key: string; title: string }[];
}) {
  if (sections.length < 2) return null;
  return (
    <nav
      aria-label="Jump to section"
      className="no-print mb-6 rounded-xl border border-sand-200 bg-white p-3 sm:p-4"
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-sand-400">
        Jump to section
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {sections.map((sec) => {
          const { number, name } = splitTitle(sec.title);
          return (
            <li key={sec.key}>
              <a
                href={`#section-${sec.key}`}
                className="flex items-center gap-1.5 rounded-full border border-sand-200 px-2.5 py-1 text-xs text-sand-600 transition hover:border-olive-600 hover:bg-olive-50 hover:text-olive-800"
              >
                {number && (
                  <span className="font-semibold text-olive-700">{number}</span>
                )}
                <span>{name}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
