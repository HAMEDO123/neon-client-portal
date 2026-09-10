// Who a cell of the board belongs to.
//
// In the order the platform decides it: a person named on the cell itself,
// then whoever holds that section of this project, then the step's standing
// owner. One rule, with no database in it, so the board, the employee portal,
// the deadlines and the analytics all resolve a cell to the same person.
export function ownerOf(
  assigneeId: string | null,
  task: { employeeId: string | null },
  sectionOwnerId: string | null | undefined
) {
  return assigneeId ?? sectionOwnerId ?? task.employeeId ?? null;
}

/** How a section holder is looked up: this section, on this project. */
export function holderKey(projectId: string, sectionId: string) {
  return `${projectId}:${sectionId}`;
}
