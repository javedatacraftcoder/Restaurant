// app/menu/[catId]/page.tsx
import CategoryClient from "./CategoryClient";

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ catId: string }>;
}) {
  const { catId } = await params; // 👈 Next 15: params se debe await
  return <CategoryClient catId={catId} />;
}
