import { NextResponse, type NextRequest } from "next/server";
import { getUserId } from "@/lib/auth";

/** Where the logo goes: the dashboard when signed in, the home page otherwise. */
export async function GET(request: NextRequest) {
  const signedIn = await getUserId().catch(() => null);
  return NextResponse.redirect(new URL(signedIn ? "/dashboard" : "/", request.url));
}
