import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

type CookieToSet = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

// Paths a sales member may open. Everything else belongs to Lodge Reporting
// and sends them to /sales.
const SALES_MEMBER_PATHS = ["/sales", "/hub", "/account", "/notifications"];

// Short-lived cookie caching "<user id>:<role>" so the role is not looked up
// on every request. Routing only: the real protection is RLS + page guards,
// so a tampered cookie gains nothing.
const ROLE_COOKIE = "lq_role";
const ROLE_COOKIE_MAX_AGE = 600; // seconds

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Routing only - not the security boundary. Every protected page calls
  // requireUser() -> getUser() (revalidates) and enforces account status, and
  // the DB enforces RLS. getSession() reads the cookie locally (no network in
  // the common case), removing an Auth API round-trip from every request.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  const path = request.nextUrl.pathname;
  // Public routes: login and the deactivated-account notice. Excluding
  // /account-inactive here is what prevents a redirect loop - requireUser sends
  // deactivated users there, and middleware must let them stay.
  const isPublicRoute =
    path.startsWith("/login") ||
    path.startsWith("/account-inactive") ||
    path.startsWith("/forgot-password") ||
    path.startsWith("/reset-password") ||
    path.startsWith("/auth/callback") ||
    // Client itinerary share links: opened by guests without an account.
    // The page itself only shows a version whose secret token is in the URL.
    path.startsWith("/i/");

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (user && path.startsWith("/login")) {
    // /hub sends each role to its own home (picker, Sales, or Lodge Reporting).
    const url = request.nextUrl.clone();
    url.pathname = "/hub";
    return NextResponse.redirect(url);
  }

  // Keep sales members inside the Sales module.
  const salesMemberAllowed = SALES_MEMBER_PATHS.some(
    (p) => path === p || path.startsWith(p + "/")
  );
  if (user && !isPublicRoute && !salesMemberAllowed) {
    let role: string | null = null;
    const cached = request.cookies.get(ROLE_COOKIE)?.value;
    if (cached && cached.startsWith(user.id + ":")) {
      role = cached.slice(user.id.length + 1);
    } else {
      const { data } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      role = (data as { role?: string } | null)?.role ?? null;
      if (role) {
        response.cookies.set(ROLE_COOKIE, `${user.id}:${role}`, {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          path: "/",
          maxAge: ROLE_COOKIE_MAX_AGE,
        });
      }
    }

    if (role === "sales_member") {
      const url = request.nextUrl.clone();
      url.pathname = "/sales";
      url.search = "";
      const redirect = NextResponse.redirect(url);
      // Carry over any refreshed auth cookies (and the role cookie).
      response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
      return redirect;
    }
  }

  return response;
}

export const config = {
  matcher: [
    // Exclude API routes (they handle their own auth - e.g. the cron endpoint),
    // Next internals, and static image files.
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
