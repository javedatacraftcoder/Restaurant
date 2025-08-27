"use client";
import { useEffect } from "react";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import { useRouter } from "next/navigation";

export default function LogoutPage() {
  const router = useRouter();
  useEffect(() => {
    (async () => {
      await signOut(auth);
      router.replace("/login");
    })();
  }, [router]);
  return <main style={{ padding: 24 }}>Cerrando sesión…</main>;
}
