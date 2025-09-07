import { Suspense } from "react";
import GoogleReturnClient from "./Client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page() {
  return (
    <Suspense fallback={null}>
      <GoogleReturnClient />
    </Suspense>
  );
}
