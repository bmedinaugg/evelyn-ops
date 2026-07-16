import { requireStaff } from "@/lib/auth";
import { Nav } from "@/components/Nav";

// Server layout for all authenticated pages. requireStaff() redirects to
// /login if the caller isn't an allow-listed staff member (defence-in-depth
// alongside the middleware gate).
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireStaff();
  return (
    <div className="app">
      <Nav email={user.email} />
      <main className="main">{children}</main>
    </div>
  );
}
