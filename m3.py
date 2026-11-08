f = r"app/(dashboard)/monthly/page.tsx"
t = open(f, encoding="utf-8").read()

# Insert services + staff carry-forward right after the energy carry-forward block closes.
# Anchor: the end of the energy block. We add new blocks before "const status =".
anchor = "  const status = (row?.status as string) ?? \"none\";"
if anchor not in t:
    print("!! status anchor missing")
else:
    inject = '''  // Services carry-forward: prefill asset + last service date from last month
  // when this month has none. Editable afterwards.
  {
    const prevServices = ((prevRow as { data?: { services?: Array<Record<string, unknown>> } } | null)?.data?.services) ?? [];
    const namedPrev = prevServices.filter((e) => String(e?.asset ?? "").trim() !== "");
    const cur = (data.services as Array<Record<string, unknown>> | undefined) ?? [];
    const curNamed = cur.some((e) => String(e?.asset ?? "").trim() !== "");
    if (namedPrev.length > 0 && !curNamed) {
      data.services = namedPrev.map((e) => ({ asset: e.asset, last_service: e.last_service }));
    }
  }

  // Staff leave carry-forward: prefill name + designation from last month, and
  // carry last month's closing into this month's opening. Editable afterwards.
  {
    const prevLeave = ((prevRow as { data?: { staff_leave?: Array<Record<string, unknown>> } } | null)?.data?.staff_leave) ?? [];
    const namedPrev = prevLeave.filter((e) => String(e?.name ?? "").trim() !== "");
    const cur = (data.staff_leave as Array<Record<string, unknown>> | undefined) ?? [];
    const curNamed = cur.some((e) => String(e?.name ?? "").trim() !== "");
    if (namedPrev.length > 0 && !curNamed) {
      data.staff_leave = namedPrev.map((e) => ({
        name: e.name,
        designation: e.designation,
        leave_opening: e.leave_closing,
      }));
    }
  }

''' + anchor
    t = t.replace(anchor, inject, 1)
    open(f, "w", encoding="utf-8").write(t)
    print("carry-forward added:", "Services carry-forward" in t and "Staff leave carry-forward" in t)
