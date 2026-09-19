// The manager's own analytics screen, rendered in the employee portal.
//
// Read-only: it shows what the client has looked at. The button that turns a
// shortfall into a deduction lives on /admin/analytics, behind requireAdmin,
// and is nowhere near this page.
export { default } from "@/app/admin/(dashboard)/projects/[id]/analytics/page";
