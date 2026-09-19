// The manager's own drawings screen, rendered in the employee portal.
//
// The same module, not a copy: the studio decided the team works a project
// exactly as the manager does, so a second implementation would be two screens
// to keep in step and one of them would drift. The actions behind it carry
// requireStaff, which is what lets an employee reach them at all.
export { default } from "@/app/admin/(dashboard)/projects/[id]/drawings/page";
