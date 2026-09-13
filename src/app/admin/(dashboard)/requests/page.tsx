import { NotebookPen, ShoppingBag } from "lucide-react";
import { prisma } from "@/lib/db";
import { decideSupplyRequest } from "@/lib/actions/operations-actions";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClasses } from "@/components/ui/buttons";
import { formatDate } from "@/lib/format";
import { getTimezone } from "@/lib/settings";
import { dayKeyToDate, formatTimeIn, todayKey } from "@/lib/time";
import { cn } from "@/lib/utils";

const TONE = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "neutral",
  PURCHASED: "cyan",
} as const;

export default async function AdminRequestsPage() {
  const requests = await prisma.supplyRequest.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
    include: { employee: { select: { name: true, role: true } } },
  });

  const pending = requests.filter((request) => request.status === "PENDING");
  const decided = requests.filter((request) => request.status !== "PENDING");

  // Today's reports, and who has not written one. One after another, the
  // convention everywhere here.
  const timezone = await getTimezone();
  const today = todayKey(timezone);
  const team = await prisma.employee.findMany({
    where: { active: true, accessRole: "EMPLOYEE" },
    orderBy: [{ order: "asc" }, { name: "asc" }],
    select: { id: true, name: true, role: true },
  });
  const reports = await prisma.dailyReport.findMany({
    where: { day: dayKeyToDate(today) },
    select: { employeeId: true, text: true, updatedAt: true },
  });
  const reportBy = new Map(reports.map((report) => [report.employeeId, report]));

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">Requests &amp; reports</h1>
      <p className="mt-1 text-sm text-ink/50">
        What the team sends in: their account of the day, and things they have asked to buy.
      </p>

      {/* --- Today's reports ------------------------------------------------ */}
      <h2 className="mt-8 inline-flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-ink/40">
        <NotebookPen size={14} strokeWidth={2} />
        Today&apos;s reports ({reports.length} of {team.length})
      </h2>

      {team.length === 0 ? (
        <EmptyState className="mt-4" icon={NotebookPen} title="No team yet" description="Reports appear here once there is somebody to write them." />
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {team.map((member) => {
            const report = reportBy.get(member.id);

            return (
              <div key={member.id} className="glass rounded-2xl p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-base font-semibold text-ink">
                    {member.name}
                    {member.role && <span className="ml-2 text-sm font-normal text-ink/45">{member.role}</span>}
                  </p>
                  {report && (
                    <p className="text-xs text-ink/40">{formatTimeIn(timezone, report.updatedAt)}</p>
                  )}
                </div>

                {report ? (
                  // dir="auto": written in Arabic as often as English.
                  <p dir="auto" className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink/75">
                    {report.text}
                  </p>
                ) : (
                  // Said as what it is. The data cannot tell a quiet day from an
                  // unwritten one, and this line must never pretend otherwise.
                  <p className="mt-2 text-sm text-ink/40">Hasn&apos;t written today&apos;s report yet.</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* --- Office supplies ------------------------------------------------ */}
      <h2 className="mt-10 inline-flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-ink/40">
        <ShoppingBag size={14} strokeWidth={2} />
        Waiting for you ({pending.length})
      </h2>

      {pending.length === 0 ? (
        <EmptyState className="mt-4" icon={ShoppingBag} title="Nothing waiting" description="New requests appear here." />
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {pending.map((request) => (
            <div key={request.id} className="glass rounded-2xl p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-base font-semibold text-ink">
                    {request.item}
                    {request.quantity && <span className="text-sm font-normal text-ink/50">{request.quantity}</span>}
                    {request.urgent && <Badge tone="pink">Urgent</Badge>}
                  </p>
                  <p className="mt-1 text-sm text-ink/50">
                    {request.employee.name}
                    {request.employee.role ? ` · ${request.employee.role}` : ""} · {formatDate(request.createdAt)}
                  </p>
                  {request.note && <p className="mt-2 text-sm text-ink/70">{request.note}</p>}
                </div>

                {request.estimatedCost != null && (
                  <p className="shrink-0 text-sm font-medium text-ink/70">
                    ≈ {request.estimatedCost.toFixed(2)} JOD
                  </p>
                )}
              </div>

              <form className="mt-4 flex flex-wrap items-center gap-2">
                <input
                  name="decisionNote"
                  placeholder="Note for the employee (optional)"
                  className="min-w-48 flex-1 rounded-lg border border-ink/12 bg-white/70 px-3 py-2 text-sm outline-none focus:border-cyan-strong"
                />
                <button
                  type="submit"
                  formAction={decideSupplyRequest.bind(null, request.id, "APPROVED")}
                  className={buttonClasses("primary", "sm")}
                >
                  Approve
                </button>
                <button
                  type="submit"
                  formAction={decideSupplyRequest.bind(null, request.id, "REJECTED")}
                  className={cn(buttonClasses("outline", "sm"), "border-red-200 text-red-600 hover:bg-red-50")}
                >
                  Decline
                </button>
              </form>
            </div>
          ))}
        </div>
      )}

      {decided.length > 0 && (
        <>
          <h2 className="mt-10 text-sm font-medium uppercase tracking-wider text-ink/40">Decided</h2>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-ink/8">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink/[0.03] text-xs uppercase tracking-wider text-ink/40">
                <tr>
                  <th className="px-4 py-3">Item</th>
                  <th className="px-4 py-3">Who</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Decided</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {decided.map((request) => (
                  <tr key={request.id} className="border-t border-ink/6">
                    <td className="px-4 py-3">
                      <span className="font-medium text-ink">{request.item}</span>
                      {request.quantity && <span className="ml-1.5 text-ink/45">{request.quantity}</span>}
                    </td>
                    <td className="px-4 py-3 text-ink/60">{request.employee.name}</td>
                    <td className="px-4 py-3">
                      <Badge tone={TONE[request.status]}>{request.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-ink/45">
                      {request.decidedAt ? formatDate(request.decidedAt) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {request.status === "APPROVED" && (
                        <form>
                          <button
                            type="submit"
                            formAction={decideSupplyRequest.bind(null, request.id, "PURCHASED")}
                            className="text-xs font-medium text-ink/50 hover:text-ink"
                          >
                            Mark bought
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
