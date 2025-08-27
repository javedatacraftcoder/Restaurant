import Protected from "@/components/Protected";
import AdminOnly from "@/components/AdminOnly";

export default function AdminPage() {
  return (
    <Protected>
      <AdminOnly>
        <main style={{ padding: 24 }}>
          <h1>Panel Admin</h1>
          <p>Solo usuarios con rol admin pueden ver esto.</p>
        </main>
      </AdminOnly>
    </Protected>
  );
}
