import { redirect } from "next/navigation";
import { getSessionEmployee } from "@/lib/employee-session";
import { EmployeeLoginForm } from "@/components/employee/login-form";

export default async function EmployeeLoginPage() {
  // Already signed in — no reason to show the form again.
  if (await getSessionEmployee()) redirect("/employee");

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6">
      <div className="grid-overlay pointer-events-none absolute inset-0 opacity-60" />
      <EmployeeLoginForm />
    </main>
  );
}
