"use client";

import { useFormStatus } from "react-dom";
import { buttonClasses } from "@/components/ui/buttons";
import { cn } from "@/lib/utils";

export function SaveButton({ label = "Save" }: { label?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClasses("primary", "sm")}>
      {pending ? "Saving…" : label}
    </button>
  );
}

export function DeleteButton({
  formAction,
  label = "Delete",
  confirmMessage = "Delete this item? This cannot be undone.",
}: {
  formAction: (formData: FormData) => void | Promise<void>;
  label?: string;
  confirmMessage?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      formAction={formAction}
      disabled={pending}
      onClick={(e) => {
        if (!confirm(confirmMessage)) e.preventDefault();
      }}
      className={cn(buttonClasses("outline", "sm"), "border-red-200 text-red-600 hover:bg-red-50")}
    >
      {label}
    </button>
  );
}
