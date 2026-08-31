import { LoginForm } from "@/components/admin/login-form";

export default function AdminLoginPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6">
      <div className="grid-overlay pointer-events-none absolute inset-0 opacity-60" />
      <LoginForm />
    </main>
  );
}
