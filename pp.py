f = r"app/(dashboard)/account/page.tsx"
t = open(f, encoding="utf-8").read()

def repl(old, new, label):
    global t
    if old not in t:
        print("!! MISSING:", label); return
    t = t.replace(old, new, 1); print("ok:", label)

# imports
repl('import { changePassword } from "./actions";',
     'import { changePassword } from "./actions";\nimport { ProfileForm } from "./profile-form";\nimport { createClient } from "@/lib/supabase/server";',
     "imports")

# searchParams type
repl("searchParams: Promise<{ error?: string; changed?: string }>;",
     "searchParams: Promise<{ error?: string; changed?: string; psaved?: string; perror?: string }>;",
     "sp type")
repl("const { error, changed } = await searchParams;",
     "const { error, changed, psaved, perror } = await searchParams;",
     "sp destructure")

# fetch profile fields
repl("const { profile } = await requireUser();",
     '''const { profile } = await requireUser();
  const sb = await createClient();
  const { data: profileRow } = await sb
    .from("profiles")
    .select("id, full_name, designation, phone, avatar_url")
    .eq("id", (profile as { id?: string })?.id ?? "")
    .maybeSingle();
  const pr = (profileRow as { id: string; full_name: string | null; designation: string | null; phone: string | null; avatar_url: string | null } | null);''',
     "fetch profile")

print("changed. Now writing.")
open(f, "w", encoding="utf-8").write(t)
