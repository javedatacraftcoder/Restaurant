// app/menu/[catId]/[subId]/page.tsx
import SubcategoryClient from "./SubcategoryClient";

export default async function SubcategoryPage({
  params,
}: {
  params: Promise<{ catId: string; subId: string }>;
}) {
  const { catId, subId } = await params; // 👈 Next 15: params se debe await
  return <SubcategoryClient catId={catId} subId={subId} />;
}
