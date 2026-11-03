import { requireSopEditor } from "@/lib/sop/server";
import { createClient } from "@/lib/supabase/server";
import { Importer } from "./importer";

export const metadata = { title: "Import SOP from Word" };

export default async function SopImportPage() {
  const { documentId } = await requireSopEditor();
  const supabase = await createClient();
  const { count } = await supabase.from("sop_sections").select("id", { count: "exact", head: true }).eq("document_id", documentId);
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl">Import the SOP from Word</h1>
        <p className="mt-1 text-sm text-sand-500">
          The file is split into sections at its section codes (A-1, A-2 ... F-7) and at &quot;Training&quot;. The slide footers (2007, 2024, 2026,
          www.pugdundeesafaris.com) and empty lines are removed; lists, tables and pictures are kept. Check the preview, then save it as the draft.
        </p>
      </div>
      <Importer hasDraft={(count ?? 0) > 0} />
    </div>
  );
}
