"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { requireEmployee } from "@/lib/employee-session";
import { saveFile } from "@/lib/storage";
import { readReceipt } from "@/lib/ai/receipts";
import { dispatchNotification } from "@/lib/notifications/engine";
import { countedReceiptAmount, periodOf } from "@/lib/payroll";
import { getTimezone } from "@/lib/settings";
import { todayKey } from "@/lib/time";
import type { PayBasis, SupplyRequestStatus } from "@/generated/prisma/enums";

// Office supply requests, expense receipts and attendance.
//
// The same rule as everywhere else in the employee portal: the employee comes
// from the session, and every employee-facing write is scoped by ownership.

async function requireAdmin() {
  const store = await cookies();
  if (!verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value)) {
    throw new Error("Unauthorized");
  }
}

function refreshEmployee() {
  revalidatePath("/employee/requests");
  revalidatePath("/employee", "layout");
}

function refreshAdmin() {
  revalidatePath("/admin/requests");
  revalidatePath("/admin/payroll");
}

// --- Office supplies -------------------------------------------------------

export async function createSupplyRequest(formData: FormData) {
  const employee = await requireEmployee();

  const item = String(formData.get("item") ?? "").trim().slice(0, 200);
  if (!item) throw new Error("Say what you need.");

  const costRaw = Number(formData.get("estimatedCost") ?? "");

  await prisma.supplyRequest.create({
    data: {
      employeeId: employee.id,
      item,
      quantity: String(formData.get("quantity") ?? "").trim().slice(0, 60) || null,
      note: String(formData.get("note") ?? "").trim().slice(0, 1000) || null,
      estimatedCost: Number.isFinite(costRaw) && costRaw > 0 ? costRaw : null,
      urgent: formData.get("urgent") === "on",
    },
  });

  refreshEmployee();
  refreshAdmin();
}

export async function cancelSupplyRequest(id: string) {
  const employee = await requireEmployee();

  // Own requests only, and only while the manager has not decided yet.
  await prisma.supplyRequest.deleteMany({
    where: { id, employeeId: employee.id, status: "PENDING" },
  });

  refreshEmployee();
  refreshAdmin();
}

export async function decideSupplyRequest(id: string, status: SupplyRequestStatus, formData?: FormData) {
  await requireAdmin();

  const decisionNote = String(formData?.get("decisionNote") ?? "").trim().slice(0, 500) || null;

  const request = await prisma.supplyRequest.update({
    where: { id },
    data: { status, decisionNote, decidedAt: new Date() },
    include: { employee: { select: { id: true, name: true } } },
  });

  const wording: Record<SupplyRequestStatus, string> = {
    PENDING: "is waiting for a decision",
    APPROVED: "was approved",
    REJECTED: "was not approved",
    PURCHASED: "has been bought",
  };

  await dispatchNotification({
    employeeId: request.employee.id,
    type: "SYSTEM_NOTIFICATION",
    title: "Supply request update",
    message: `Your request for ${request.item} ${wording[status]}.${decisionNote ? ` ${decisionNote}` : ""}`,
    url: "/employee/requests",
    // One notification per decision, so re-saving the same decision is silent.
    dedupeKey: `SUPPLY:${request.id}:${status}`,
  }).catch(() => {});

  refreshAdmin();
  refreshEmployee();
}

// --- Expense receipts (salary++) -------------------------------------------

export async function submitReceipt(formData: FormData) {
  const employee = await requireEmployee();

  const photo = formData.get("photo");
  if (!(photo instanceof File) || photo.size === 0) throw new Error("Attach a photo of the receipt.");

  const saved = await saveFile(photo, `receipts/${employee.id}`, "image");
  const timezone = await getTimezone();

  const receipt = await prisma.expenseReceipt.create({
    data: {
      employeeId: employee.id,
      imageUrl: saved.url,
      // Provisionally this month; the reading may move it to the month the
      // receipt itself is dated.
      periodMonth: periodOf(todayKey(timezone)),
    },
  });

  // Read it straight away. A failure here leaves the row PENDING with a note
  // rather than losing the receipt.
  const result = await readReceipt(saved.url);

  if (result.ok) {
    const { reading } = result;
    await prisma.expenseReceipt.update({
      where: { id: receipt.id },
      data: {
        status: "ANALYZED",
        vendor: reading.vendor,
        receiptDate: reading.date ? new Date(`${reading.date}T00:00:00.000Z`) : null,
        rawAmount: reading.amount,
        countedAmount: countedReceiptAmount(reading.amount),
        currency: reading.currency,
        summary: reading.summary,
        aiNotes: reading.notes,
        periodMonth: reading.date ? periodOf(reading.date) : receipt.periodMonth,
      },
    });
  } else {
    await prisma.expenseReceipt.update({
      where: { id: receipt.id },
      data: { status: "FAILED", aiNotes: result.error },
    });
  }

  refreshEmployee();
  refreshAdmin();
}

export async function deleteReceipt(id: string) {
  const employee = await requireEmployee();
  await prisma.expenseReceipt.deleteMany({ where: { id, employeeId: employee.id } });
  refreshEmployee();
  refreshAdmin();
}

/** The manager can correct what the model read, and the cap re-applies. */
export async function correctReceipt(id: string, formData: FormData) {
  await requireAdmin();

  const rawAmount = Number(formData.get("rawAmount") ?? "");
  const amount = Number.isFinite(rawAmount) && rawAmount > 0 ? rawAmount : null;

  await prisma.expenseReceipt.update({
    where: { id },
    data: {
      rawAmount: amount,
      countedAmount: countedReceiptAmount(amount),
      vendor: String(formData.get("vendor") ?? "").trim().slice(0, 120) || null,
      status: "ANALYZED",
    },
  });

  refreshAdmin();
}

// --- Attendance ------------------------------------------------------------

/**
 * Records how late someone was on one day. Upserted on (employee, day) so the
 * attendance device can push the same shape later without creating duplicates.
 */
export async function setAttendance(formData: FormData) {
  await requireAdmin();

  const employeeId = String(formData.get("employeeId") ?? "");
  const day = String(formData.get("day") ?? "");
  const hoursRaw = Number(formData.get("delayHours") ?? 0);

  if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Pick an employee and a day.");

  const delayHours = Number.isFinite(hoursRaw) ? Math.max(0, Math.min(hoursRaw, 24)) : 0;
  const date = new Date(`${day}T00:00:00.000Z`);

  await prisma.attendanceRecord.upsert({
    where: { employeeId_day: { employeeId, day: date } },
    create: {
      employeeId,
      day: date,
      delayHours,
      note: String(formData.get("note") ?? "").trim().slice(0, 200) || null,
    },
    update: {
      delayHours,
      note: String(formData.get("note") ?? "").trim().slice(0, 200) || null,
    },
  });

  refreshAdmin();
}

export async function deleteAttendance(id: string) {
  await requireAdmin();
  await prisma.attendanceRecord.delete({ where: { id } });
  refreshAdmin();
}

export async function setEmployeePay(id: string, formData: FormData) {
  await requireAdmin();

  const amount = Number(formData.get("salaryAmount") ?? "");
  const basisRaw = String(formData.get("payBasis") ?? "MONTHLY");
  const payBasis: PayBasis = basisRaw === "WEEKLY" ? "WEEKLY" : "MONTHLY";

  await prisma.employee.update({
    where: { id },
    data: {
      salaryAmount: Number.isFinite(amount) && amount > 0 ? amount : null,
      payBasis,
    },
  });

  refreshAdmin();
  revalidatePath(`/admin/employees/${id}`);
}
