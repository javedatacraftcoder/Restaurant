import { Suspense } from "react";
import GoogleStartClient from "./Client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page() {
  return (
    <Suspense fallback={null}>
      <GoogleStartClient />
    </Suspense>
  );
}
