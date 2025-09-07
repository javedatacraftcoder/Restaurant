import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../[...nextauth]/route";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = url.searchParams.get("next") || "/app";

  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    // No hay sesión de NextAuth -> de vuelta al login
    const back = new URL("/login", req.url);
    back.searchParams.set("next", next);
    return NextResponse.redirect(back);
  }

  // Ponemos una cookie "session" simple para satisfacer tu middleware actual
  const res = NextResponse.redirect(new URL(next, req.url));
  res.cookies.set("session", "1", {
    path: "/",
    httpOnly: false,
    sameSite: "lax",
  });
  // Si necesitas rol, aquí podrías setear res.cookies.set("appRole", "customer", {...})

  return res;
}
