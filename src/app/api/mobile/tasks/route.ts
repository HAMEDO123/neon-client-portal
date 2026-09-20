import { NextResponse } from "next/server";
import { mobileEmployee } from "@/lib/mobile-auth";
import { allTasks } from "@/lib/employee-tasks";

// Everything on this person's plate. `?filter=open` or `?filter=completed`;
// anything else means all of it.
//
// Whose work it is comes from `ownedBy` inside allTasks — the one rule that
// decides ownership (the cell's assignee, else the section holder, else the
// step's standing owner). A filter written out again here would be a second
// answer to that question.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const employee = await mobileEmployee(request);
  if (!employee) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const asked = new URL(request.url).searchParams.get("filter");
  const filter = asked === "open" || asked === "completed" ? asked : undefined;

  return NextResponse.json({ filter: filter ?? "all", tasks: await allTasks(employee.id, filter) });
}
