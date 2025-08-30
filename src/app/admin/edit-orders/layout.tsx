// Asegúrate de envolver en tu providers globales si los usas.
import { EditCartProvider } from "@/lib/edit-cart/context";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <EditCartProvider>{children}</EditCartProvider>;
}
