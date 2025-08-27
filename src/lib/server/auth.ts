import { adminAuth } from "@/lib/firebase/admin";

export async function getUserFromRequest(req: Request) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return { uid: decoded.uid, role: (decoded as any).role as "admin" | "client" | undefined };
  } catch {
    return null;
  }
}
