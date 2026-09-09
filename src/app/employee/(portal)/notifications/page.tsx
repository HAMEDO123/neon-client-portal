import { Bell } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireEmployee } from "@/lib/employee-session";
import { NotificationList } from "@/components/employee/notification-list";
import { EmptyState } from "@/components/ui/empty-state";

export default async function EmployeeNotificationsPage() {
  const employee = await requireEmployee();

  // Scoped to the session's employee — there is no route that can ask for
  // anyone else's notifications.
  const notifications = await prisma.notification.findMany({
    where: { employeeId: employee.id },
    orderBy: [{ readAt: "asc" }, { createdAt: "desc" }],
    take: 100,
    select: {
      id: true,
      type: true,
      title: true,
      message: true,
      url: true,
      readAt: true,
      createdAt: true,
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-ink">Notifications</h1>

      {notifications.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No notifications yet"
          description="New tasks, updates and your daily schedule will appear here."
        />
      ) : (
        <NotificationList notifications={notifications} />
      )}
    </div>
  );
}
