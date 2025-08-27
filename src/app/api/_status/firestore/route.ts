import { adminDb } from "@/lib/firebase/admin";

export async function GET() {
  try {
    // ping rápido
    await adminDb.collection("_status").doc("_ping").set({ ts: Date.now() }, { merge: true });
    return Response.json({ firestore: "ok" });
  } catch (e: any) {
    return Response.json({ firestore: "error", message: e?.message }, { status: 500 });
  }
}
