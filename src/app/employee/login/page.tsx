import { redirect } from "next/navigation";
import { getSessionEmployee } from "@/lib/employee-session";
import { EmployeeLoginForm } from "@/components/employee/login-form";

export default async function EmployeeLoginPage() {
  // Already signed in — no reason to show the form again.
  if (await getSessionEmployee()) redirect("/employee");

  return (
    // employee-signin carries the portal's warm tokens: this screen sits
    // outside the shell that normally provides them, and it is the first one
    // anybody sees.
    <main className="employee-signin relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6">
      <div className="grid-overlay pointer-events-none absolute inset-0 opacity-60" />
      <EmployeeLoginForm />
    </main>
  );
}
