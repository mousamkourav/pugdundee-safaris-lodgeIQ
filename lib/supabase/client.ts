import { createBrowserClient } from "@supabase/ssr";

// Untyped for now. After you run the app, generate real DB types and add the
// <Database> generic for full type-safety:
//   npx supabase gen types typescript --project-id <ref> > lib/database.types.ts
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
