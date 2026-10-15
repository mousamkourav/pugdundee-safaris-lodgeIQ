f = r"app/(dashboard)/account/actions.ts"
t = open(f, encoding="utf-8").read()
t = t.replace(
  "  const patch = {\n    full_name,\n    designation: designation || null,\n    phone: phone || null,\n  };",
  "  const patch: Record<string, string | null> = {\n    full_name,\n    designation: designation || null,\n    phone: phone || null,\n  };")
open(f, "w", encoding="utf-8").write(t)
print("patched:", "Record<string, string | null>" in t)
