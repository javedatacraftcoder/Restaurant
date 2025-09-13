// src/app/logout/page.tsx
"use client";

import { useEffect } from "react";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import { useRouter } from "next/navigation";
import AuthNavbar from "@/components/AuthNavbar";

export default function LogoutPage() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      await signOut(auth);
      router.replace("/login");
    })();
  }, [router]);

  return (
    <>
      <AuthNavbar />
      <main style={{ padding: 24 }}>Signing out…</main>
    </>
  );
}
