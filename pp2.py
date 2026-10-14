f = r"app/(dashboard)/account/page.tsx"
t = open(f, encoding="utf-8").read()

start_str = '<h3 className="mb-3 text-base font-medium text-sand-800">Profile</h3>'
i = t.find(start_str)
if i == -1:
    print("!! Profile heading not found"); raise SystemExit

# Walk back to the opening <div ...> of the card
card_open = t.rfind('<div', 0, i)
# The card contains one inner <div className="space-y-2 text-sm"> ... </div>, then the card </div>.
# Find the "Change password" card start; the Profile card ends right before it.
cp = t.find('<h3 className="mb-3 text-base font-medium text-sand-800">Change password</h3>')
if cp == -1:
    print("!! Change password heading not found"); raise SystemExit
# the Change password card's opening <div> is just before cp
cp_card_open = t.rfind('<div className="rounded-xl border border-sand-200 bg-white p-5">', 0, cp)

new_card = '''<div className="rounded-xl border border-sand-200 bg-white p-5">
            <h3 className="mb-3 text-base font-medium text-sand-800">Profile</h3>
            {psaved && (
              <p className="mb-4 rounded-lg bg-success-bg px-3 py-2 text-sm text-success">Profile updated.</p>
            )}
            {perror && (
              <p className="mb-4 rounded-lg bg-error-bg px-3 py-2 text-sm text-error">{perror}</p>
            )}
            <div className="mb-4 flex justify-between border-b border-sand-100 py-1.5 text-sm">
              <span className="text-sand-500">Role</span>
              <span className="capitalize text-sand-800">{String(profile?.role ?? "").replace(/_/g, " ")}</span>
            </div>
            <ProfileForm
              userId={pr?.id ?? ""}
              fullName={pr?.full_name ?? ""}
              designation={pr?.designation ?? ""}
              phone={pr?.phone ?? ""}
              avatarUrl={pr?.avatar_url ?? ""}
            />
          </div>

          '''

# Replace from the Profile card opening div up to (not including) the Change password card opening div
t = t[:card_open] + new_card + t[cp_card_open:]
open(f, "w", encoding="utf-8").write(t)
print("ok: profile card replaced")
