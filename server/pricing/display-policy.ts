/** Shared display lifetime: refresh eligibility may expire earlier than display. */
export function soldgraphDisplayMaxAgeDays() {
  const days = Number(process.env.SOLDGRAPH_DISPLAY_MAX_AGE_DAYS ?? 14);
  if (!Number.isFinite(days) || days < 1) throw new Error("Invalid SoldGraph display age");
  return days;
}
