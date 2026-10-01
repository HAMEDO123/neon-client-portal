// Reading a purchase request off a form.
//
// Pure, and a module of its own, because this is the one part of a supply
// request that can be wrong while everything we run says it is fine: a form is
// untyped, so a caller sending field names nothing reads typechecks, lints and
// builds, and fails only when somebody presses the button.
//
// That is not hypothetical. The form used to carry one thing to buy — `item`,
// `quantity`, `estimatedCost` — and was rewritten to carry a list. The website
// was updated with it; the iOS app, the only other caller, was not, and every
// request sent from a phone came back "Add at least one thing to buy" with
// nothing wrong at the sending end. Hence `readSupplyLines` reads **both**
// shapes, and `tests/supply-requests.test.ts` pins both.

export type SupplyLine = {
  name: string;
  /** How many of them, or null when nobody said. */
  count: number | null;
  /** What the line costs altogether — never each, so nothing multiplies it. */
  estimatedCost: number | null;
  position: number;
};

/** A cost box that is empty, not a number, or zero means "no answer", never "free". */
function costOf(value: FormDataEntryValue | undefined): number | null {
  if (value === undefined) return null;
  const amount = Number(String(value).trim());
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/**
 * How many, from a box somebody typed in.
 *
 * Whole ones only, and at least one: half a chair is not a thing to buy, and a
 * count of zero is an empty box rather than a request for none of something.
 * The ceiling is there because the figure is typed on a phone, where a long
 * press on a key is how 999999 gets into a form nobody meant it in.
 */
function countOf(value: FormDataEntryValue | undefined): number | null {
  if (value === undefined) return null;
  const many = Number(String(value).trim());
  if (!Number.isFinite(many) || many < 1) return null;
  return Math.min(Math.floor(many), 9999);
}

function textOf(value: FormDataEntryValue | undefined, max: number): string {
  return value === undefined ? "" : String(value).trim().slice(0, max);
}

/**
 * Every thing being bought, in the order they were typed.
 *
 * The list form wins where it has anything at all; the single-item form is read
 * as a list of one, which is exactly what it always was. Rows with no name are
 * dropped — an empty box somebody added and did not fill in is not a thing to
 * buy — and the positions are renumbered afterwards so they stay 0, 1, 2.
 */
export function readSupplyLines(formData: FormData): SupplyLine[] {
  const names = formData.getAll("lineName");
  const counts = formData.getAll("lineCount");
  // The count used to be a free-text box under this name. A page left open
  // across the deploy still posts it, and "3" typed into it is still three —
  // which is the whole lesson of the last release, written down in the README
  // under "a changed form is a changed API".
  const legacyCounts = formData.getAll("lineQuantity");
  const costs = formData.getAll("lineCost");

  const rows: SupplyLine[] =
    names.length > 0
      ? names.map((value, index) => ({
          name: textOf(value, 200),
          count: countOf(counts[index] ?? legacyCounts[index]),
          estimatedCost: costOf(costs[index]),
          position: index,
        }))
      : [
          {
            // The one thing the iOS app sends, read as a list of one. Its
            // `quantity` is free text there, so it counts only when somebody
            // typed a number into it.
            name: textOf(formData.get("item") ?? undefined, 200),
            count: countOf(formData.get("count") ?? formData.get("quantity") ?? undefined),
            estimatedCost: costOf(formData.get("estimatedCost") ?? undefined),
            position: 0,
          },
        ];

  return rows
    .filter((line) => line.name.length > 0)
    .map((line, index) => ({ ...line, position: index }));
}

/**
 * What the request is called in one line, for the screens and the notification
 * that have only ever had room for one.
 */
export function headlineOf(lines: SupplyLine[]): string {
  if (lines.length === 0) return "";
  return lines.length === 1 ? lines[0].name : `${lines[0].name} and ${lines.length - 1} more`;
}

/**
 * How many things in all, for the one line the old screens have room for.
 *
 * Null when nobody counted anything, so a request reads "3 things" or nothing
 * rather than "0 things" — which would say the opposite of what it means.
 */
export function countedOf(lines: SupplyLine[]): number | null {
  const total = lines.reduce((sum, line) => sum + (line.count ?? 0), 0);
  return total > 0 ? total : null;
}

/** What it adds up to, or null when nobody put a figure on anything. */
export function totalOf(lines: SupplyLine[]): number | null {
  const total = lines.reduce((sum, line) => sum + (line.estimatedCost ?? 0), 0);
  // Rounded, or 0.1 + 0.2 reaches the manager as 0.30000000000000004 JOD.
  return total > 0 ? Math.round(total * 100) / 100 : null;
}

/**
 * The quantity in words, for the screens that have one line and no room for a
 * list: "3", "2 items", "5 items · 12 things".
 *
 * Null rather than "0 things" when nobody counted anything — a request for
 * coffee with no number on it has an unknown quantity, not none.
 */
export function summaryOf(lines: SupplyLine[]): string | null {
  if (lines.length === 0) return null;

  const counted = countedOf(lines);
  if (lines.length === 1) return counted === null ? null : String(counted);

  const items = `${lines.length} items`;
  return counted === null ? items : `${items} · ${counted} things`;
}
