import { avatarColor, initialsOf } from "@/lib/avatar";
import { cn } from "@/lib/utils";

// Somebody's initials on their colour, drawn in place rather than fetched. A
// task card can carry several people, and none of their faces should wait on
// the network or arrive after the card has been laid out.

export function PersonAvatar({
  name,
  color,
  size = 28,
  className,
}: {
  name: string;
  color?: string | null;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white", className)}
      style={{ width: size, height: size, backgroundColor: avatarColor(color), fontSize: Math.round(size * 0.38) }}
    >
      {initialsOf(name)}
    </span>
  );
}
