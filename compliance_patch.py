f = r"app/(dashboard)/compliance/page.tsx"
t = open(f, encoding="utf-8").read()
orig = t

def repl(old, new, label):
    global t
    if old not in t:
        print("!! ANCHOR MISSING:", label); return
    t = t.replace(old, new, 1); print("ok:", label)

repl(
"""type Doc = {
  id: string;
  doc_type: string | null;
  title: string;
  issue_date: string | null;
  expiry_date: string | null;
  notes: string | null;
};""",
"""type Doc = {
  id: string;
  lodge_id: string;
  doc_type: string | null;
  title: string;
  issue_date: string | null;
  expiry_date: string | null;
  notes: string | null;
};""", "Doc lodge_id")

repl(
"""  const lodge = resolveLodge(sp.lodge, lodges);
  if (!lodge) return <NoLodge title="Insurances & licences" />;

  const s = await createClient();
  const { data: rows } = await s
    .from("compliance_documents")
    .select("id, doc_type, title, issue_date, expiry_date, notes")
    .eq("lodge_id", lodge)
    .order("expiry_date", { ascending: true, nullsFirst: false });

  const docs = (rows as Doc[]) ?? [];
  const lodgeName = lodges.find((l) => l.id === lodge)?.name ?? "Lodge";""",
"""  if (lodges.length === 0) return <NoLodge title="Insurances & licences" />;
  const lodge = sp.lodge ? resolveLodge(sp.lodge, lodges) : null;

  const s = await createClient();
  let docQuery = s
    .from("compliance_documents")
    .select("id, lodge_id, doc_type, title, issue_date, expiry_date, notes")
    .order("expiry_date", { ascending: true, nullsFirst: false });
  if (lodge) docQuery = docQuery.eq("lodge_id", lodge);
  const { data: rows } = await docQuery;

  const docs = (rows as Doc[]) ?? [];
  const lodgeNameById = new Map(lodges.map((l) => [l.id, l.name]));
  const lodgeName = lodge ? (lodges.find((l) => l.id === lodge)?.name ?? "Lodge") : "All lodges";""", "optional lodge + query")

repl(
"""  const slug = lodgeSlug(lodgeName);
  const catHref = (c: string | null) =>
    `/compliance?lodge=${encodeURIComponent(slug)}${c ? `&cat=${encodeURIComponent(c)}` : ""}`;""",
"""  const lodgeParam = lodge ? `lodge=${encodeURIComponent(lodgeSlug(lodgeName))}` : "";
  const catHref = (c: string | null) => {
    const parts = [lodgeParam, c ? `cat=${encodeURIComponent(c)}` : ""].filter(Boolean);
    return "/compliance" + (parts.length ? "?" + parts.join("&") : "");
  };""", "catHref null-safe")

repl(
"""                {lodgeName} - {docs.length} documents
              </span>""",
"""                {lodgeName} - {docs.length} documents
              </span>
              {lodge && (
                <Link href="/compliance" className="font-medium normal-case tracking-normal text-olive-700 hover:underline">
                  Show all lodges
                </Link>
              )}""", "header clear link")

repl(
"""            <input type="hidden" name="lodge" value={lodge} />
            <label className="block">
              <span className={labelCls}>Category</span>""",
"""            {lodge ? (
              <input type="hidden" name="lodge" value={lodge} />
            ) : (
              <label className="block sm:col-span-2 lg:col-span-1">
                <span className={labelCls}>Lodge *</span>
                <select name="lodge" required defaultValue="" className={inputCls}>
                  <option value="" disabled>Select lodge</option>
                  {lodges.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="block">
              <span className={labelCls}>Category</span>""", "add-form lodge selector")

repl(
"""                          <input type="hidden" name="id" value={d.id} />
                          <input type="hidden" name="lodge" value={lodge} />""",
"""                          <input type="hidden" name="id" value={d.id} />
                          <input type="hidden" name="lodge" value={d.lodge_id} />""", "edit-form lodge")

repl(
"""                                  {cat}
                                </span>
                                {text && <span className="break-words">{text}</span>}""",
"""                                  {cat}
                                </span>
                                {!lodge && (
                                  <span className="rounded bg-olive-50 px-1.5 py-px font-medium text-olive-700">
                                    {lodgeNameById.get(d.lodge_id) ?? "Lodge"}
                                  </span>
                                )}
                                {text && <span className="break-words">{text}</span>}""", "row lodge badge")

open(f, "w", encoding="utf-8").write(t)
print("changed:", t != orig)
