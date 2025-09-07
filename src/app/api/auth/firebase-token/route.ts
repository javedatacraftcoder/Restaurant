// src/app/api/auth/firebase-token/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../[...nextauth]/route";
import { adminAuth } from "@/lib/firebase/admin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "NO_SESSION" }, { status: 401 });
    }

    const providerSub = (session.user as any)?.id as string | undefined;
    if (!providerSub) {
      return NextResponse.json({ error: "NO_SUB" }, { status: 400 });
    }

    const uid = `google:${providerSub}`;
    const email = session.user.email!;
    const displayName = session.user.name ?? undefined;
    const photoURL = session.user.image ?? undefined;

    // Asegura existencia del usuario
    let exists = true;
    try {
      await adminAuth.getUser(uid);
    } catch {
      exists = false;
    }
    if (!exists) {
      try {
        await adminAuth.createUser({
          uid,
          email,
          emailVerified: true,
          displayName,
          photoURL,
        });
      } catch (e: any) {
        if (e?.code === "auth/email-already-exists") {
          await adminAuth.createUser({ uid, displayName, photoURL });
        } else {
          throw e;
        }
      }
    }

    // Sincroniza perfil y email si está libre
    try {
      const byEmail = await adminAuth.getUserByEmail(email);
      if (byEmail.uid === uid) {
        await adminAuth.updateUser(uid, {
          email,
          emailVerified: true,
          displayName,
          photoURL,
        });
      } else {
        await adminAuth.updateUser(uid, { displayName, photoURL });
      }
    } catch {
      try {
        await adminAuth.updateUser(uid, {
          email,
          emailVerified: true,
          displayName,
          photoURL,
        });
      } catch (e2: any) {
        if (e2?.code === "auth/email-already-exists") {
          await adminAuth.updateUser(uid, { displayName, photoURL });
        } else {
          throw e2;
        }
      }
    }

    // Lee claims persistentes (los que gestionas con tu UI / API de admin)
    let persistentClaims: Record<string, any> = {};
    try {
      const rec = await adminAuth.getUser(uid);
      persistentClaims = rec.customClaims || {};
    } catch {
      persistentClaims = {};
    }

    // Claims informativos para el token
    const infoClaims = {
      email,
      email_verified: true,
      name: displayName ?? null,
      picture: photoURL ?? null,
      provider: "google",
    };

    // Emitimos el custom token con los claims existentes (roles) + info
    const token = await adminAuth.createCustomToken(uid, {
      ...persistentClaims,
      ...infoClaims,
    });

    return NextResponse.json(
      { token },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    console.error("[api/auth/firebase-token] error", e);
    return NextResponse.json(
      { error: "INTERNAL", code: e?.code ?? null, message: e?.message ?? null },
      { status: 500 }
    );
  }
}
