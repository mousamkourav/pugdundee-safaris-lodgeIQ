# LodgeIQ — Edit-request approval workflow

Manager requests edit access on a locked report -> super admin/senior manager gets
a notification -> approve/decline (in Notifications AND on the report). Approve
flips the report back to draft so the manager can edit; on re-submit it locks again.

## Prerequisite (already done)
edit_requests_schema.sql has been run in Supabase.

## Apply — in the project root, in order:

1) Copy the new actions file into place:
   The file app/(dashboard)/monthly/edit-requests.ts is included in this zip.
   (Expand-Archive will place it correctly.)

2) Patch the monthly page (adds request button + approve/decline on the report):
   python patch_page.py
   -> expect: import: True / editPending state: True / request button: True / approve button: True

3) Patch the notifications page (adds approve/decline on edit-request alerts):
   python patch_notifications.py
   -> expect: notif import: True / approve UI: True

4) Build:
   npm run build

5) If it compiles, delete the patch scripts and push:
   Remove-Item patch_page.py, patch_notifications.py
   git add -A
   git commit -m "Edit-request approval workflow"
   git push origin main

## How it works
- Manager on a locked (submitted) report sees "Request edit access".
- That inserts an edit_requests row (pending) + a notification to admins (with the
  month stored in notification.extra so approve works from Notifications).
- Admin approves -> request marked approved + submission set back to draft -> manager
  can edit. Manager re-submits -> locks again (normal submit flow).
- Admin can approve/decline from the Notifications page or directly on the report.
