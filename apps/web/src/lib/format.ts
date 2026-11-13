/** Turn DB/API codes like `pending_verification` into `Pending verification`. */
export function formatLabel(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  const spaced = String(value).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!spaced) return "—";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
