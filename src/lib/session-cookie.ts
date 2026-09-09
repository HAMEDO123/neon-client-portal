export const SESSION_COOKIE_NAME = "admin_session";

// Employees get their own cookie rather than a role claim inside the admin
// one: an admin session can never be mistaken for an employee session, and
// signing out of one does not disturb the other.
export const EMPLOYEE_SESSION_COOKIE_NAME = "employee_session";
