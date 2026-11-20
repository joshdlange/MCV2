import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertCircle, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";

type Interval = "day" | "week";
interface Editor {
  id: number;
  username: string;
  displayName?: string | null;
}
interface ActivityPeriod {
  period: string;
  images: number;
  updates: number;
  cards: number;
  unknownUpdates: number;
}
interface ActivityResponse {
  interval: Interval;
  timeZone: "America/Chicago";
  periods: ActivityPeriod[];
  firstRecordedAt: string | null;
}

const CENTRAL = "America/Chicago";
const number = new Intl.NumberFormat("en-US");
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fullDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

// Periods are Central calendar dates, not instants. UTC is only a stable
// calendar coordinate here: never parse these keys in the viewer's timezone.
function calendarTime(period: string) {
  const [year, month, day] = period.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function currentPeriod(interval: Interval) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CENTRAL, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  const date = new Date(calendarTime(`${part("year")}-${part("month")}-${part("day")}`));
  if (interval === "week") date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

function periodLabel(period: string, interval: Interval) {
  return `${interval === "week" ? "Week of " : ""}${fullDate.format(calendarTime(period))}`;
}

export default function ImageAdminActivity({
  imageAdmins,
  isLoading: editorsLoading = false,
}: {
  imageAdmins: Editor[];
  isLoading?: boolean;
}) {
  const headingId = useId();
  const editorId = useId();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [interval, setInterval] = useState<Interval>("day");
  const defaultEditor = imageAdmins.find((editor) => editor.username === "yours_sincerely2006") ?? imageAdmins[0];
  const editor = imageAdmins.find((item) => String(item.id) === selectedId) ?? defaultEditor;
  const { data, isLoading, isError, isFetching, refetch } = useQuery<ActivityResponse>({
    queryKey: ["/api/admin/image-admins", editor?.id, "activity", interval],
    enabled: !!editor && !editorsLoading,
    queryFn: async ({ signal }) => {
      const response = await apiRequest(
        "GET", `/api/admin/image-admins/${editor!.id}/activity?interval=${interval}`, undefined, signal,
      );
      return response.json();
    },
    staleTime: 60_000,
    retry: false,
  });
  const current = currentPeriod(interval);
  const periods = [...(data?.periods ?? [])].sort((a, b) => a.period.localeCompare(b.period));
  const chartData = periods.map((period) => ({ ...period, timestamp: calendarTime(period.period) }));
  const completed = periods.filter((period) => period.period < current);
  const latest = completed[completed.length - 1];
  const prior = completed[completed.length - 2];
  const delta = latest && prior ? latest.images - prior.images : null;
  const totalImages = periods.reduce((sum, period) => sum + period.images, 0);
  const unknownUpdates = periods.reduce((sum, period) => sum + period.unknownUpdates, 0);
  const hasActivity = periods.some((period) => period.images > 0 || period.updates > 0 || period.unknownUpdates > 0);
  const busy = editorsLoading || (!!editor && isLoading);

  return (
    <section aria-labelledby={headingId} className="min-w-0 border-t border-gray-200 p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 id={headingId} className="text-base font-semibold text-gray-900">Image activity</h3>
          <p className="mt-1 text-sm text-gray-600">
            Changed front and back images, including replacements.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 sm:w-64">
            <label id={editorId} className="mb-1 block text-xs font-medium text-gray-600">Editor</label>
            <Select value={editor ? String(editor.id) : ""} onValueChange={setSelectedId} disabled={editorsLoading || !imageAdmins.length}>
              <SelectTrigger aria-labelledby={editorId} className="w-full bg-white">
                <SelectValue placeholder="Select an editor" />
              </SelectTrigger>
              <SelectContent>
                {imageAdmins.map((item) => (
                  <SelectItem key={item.id} value={String(item.id)}>{item.username}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div role="group" aria-label="Activity interval" className="flex gap-1 rounded-md border border-gray-200 bg-gray-50 p-1">
            {(["day", "week"] as const).map((value) => (
              <Button key={value} type="button" size="sm" variant="ghost" aria-pressed={interval === value}
                onClick={() => setInterval(value)}
                className={`flex-1 ${interval === value ? "bg-blue-100 text-blue-900 hover:bg-blue-100" : "text-gray-600"}`}>
                {value === "day" ? "Daily" : "Weekly"}
              </Button>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-3 text-xs text-gray-500">
        {interval === "day" ? "Last 30 calendar days" : "Last 12 weeks"} · Central time (America/Chicago) · Weeks start Monday · Current {interval} is partial.
      </p>

      {busy ? (
        <div role="status" className="mt-5 space-y-4 motion-safe:animate-pulse">
          <span className="sr-only">Loading image activity</span>
          <div className="h-12 w-48 rounded bg-gray-100" />
          <div className="h-56 rounded bg-gray-100" />
        </div>
      ) : !editor ? (
        <div className="mt-5 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-5 py-8 text-center">
          <BarChart3 aria-hidden="true" className="mx-auto mb-2 h-6 w-6 text-blue-700" />
          <p className="text-sm font-medium text-gray-900">Select an Image Admin to track activity</p>
          <p className="mt-1 text-sm text-gray-500">Editors will appear here once available in the list above.</p>
        </div>
      ) : isError ? (
        <div role="alert" className="mt-5 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <AlertCircle aria-hidden="true" className="h-5 w-5 shrink-0 text-amber-700" />
          <div className="flex-1 text-sm text-gray-800">
            <p className="font-medium">Image activity could not be loaded</p>
            <p>Try again. This report requires full admin access.</p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => void refetch()} disabled={isFetching}>
            {isFetching ? "Retrying…" : "Retry"}
          </Button>
        </div>
      ) : data ? (
        <div className="mt-5 space-y-4">
          <div className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500">Images in this window</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{number.format(totalImages)}</p>
            </div>
            <div className="text-sm text-gray-600 sm:max-w-md sm:text-right">
              {latest && prior && delta !== null ? (
                <>
                  <p className="font-medium text-gray-900">
                    {number.format(latest.images)} images · {periodLabel(latest.period, interval)}
                  </p>
                  <p className="mt-1">
                    {delta === 0 ? "No change" : `${delta > 0 ? "+" : "−"}${number.format(Math.abs(delta))} images`}
                    {prior.images > 0 && ` (${delta > 0 ? "+" : ""}${number.format(Math.round(delta / prior.images * 100))}%)`}
                    {" vs. "}{periodLabel(prior.period, interval)}
                    {prior.images === 0 && " (prior period: 0; percentage not applicable)"}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">Completed periods only</p>
                </>
              ) : <p>Not enough completed periods to compare.</p>}
            </div>
          </div>

          {!hasActivity ? (
            <div role="status" className="rounded-lg border border-dashed border-gray-200 py-7 text-center">
              <BarChart3 aria-hidden="true" className="mx-auto mb-2 h-6 w-6 text-blue-700" />
              <p className="text-sm font-medium text-gray-900">
                {data.firstRecordedAt ? "No activity in this window" : "No recorded image activity yet"}
              </p>
              <p className="mt-1 px-4 text-sm text-gray-500">Recorded image updates for {editor.username} will appear here.</p>
            </div>
          ) : (
            <div role="img" aria-label={`Images changed by ${editor.username}, ${interval === "day" ? "daily" : "weekly"}. ${number.format(totalImages)} images in the displayed window. Exact counts in the table below.`} className="min-w-0">
              <p className="mb-2 text-xs font-medium text-gray-600">Images changed</p>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 10, bottom: 8, left: 0 }}>
                    <CartesianGrid vertical={false} stroke="#e5e7eb" />
                    <XAxis dataKey="timestamp" type="number" scale="utc" domain={["dataMin", "dataMax"]}
                      tickFormatter={(value: number) => shortDate.format(value)} minTickGap={35}
                      tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, "auto"]} allowDecimals={false} width={48}
                      tickFormatter={(value: number) => number.format(value)}
                      tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: "#f3f4f6" }} content={({ active, payload }) => {
                      const row = payload?.[0]?.payload as ActivityPeriod | undefined;
                      if (!active || !row) return null;
                      return (
                        <div className="rounded-md border border-gray-200 bg-white p-3 text-xs text-gray-700 shadow-sm">
                          <p className="mb-2 font-semibold">{periodLabel(row.period, interval)}{row.period === current ? " (partial)" : ""}</p>
                          <p>{number.format(row.images)} images changed</p>
                          <p>{number.format(row.updates)} updates</p>
                          <p>{number.format(row.cards)} cards</p>
                          <p>{number.format(row.unknownUpdates)} updates with unknown sides</p>
                        </div>
                      );
                    }} />
                    <Bar dataKey="images" name="Images changed" fill="#61A9BD" maxBarSize={36}
                      radius={[2, 2, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="space-y-1 text-xs leading-relaxed text-gray-500">
            <p>Each changed front or back counts as one image, including replacements. Updates are edit events; cards are distinct within each period and should not be summed across periods.</p>
            <p>{number.format(unknownUpdates)} updates with unknown side information in this window are excluded from image counts.</p>
            {data.firstRecordedAt && (
              <p>First recorded activity: {new Intl.DateTimeFormat("en-US", {
                timeZone: CENTRAL, year: "numeric", month: "short", day: "numeric",
              }).format(new Date(data.firstRecordedAt))} (Central time).</p>
            )}
          </div>
          {periods.length > 0 && (
            <details className="rounded-md border border-gray-200">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700">
                View exact counts ({periods.length} periods)
              </summary>
              <div className="overflow-x-auto border-t border-gray-200">
                <table className="w-full text-sm">
                  <caption className="sr-only">{editor.username}: {interval === "day" ? "daily" : "weekly"} activity in Central time. Current period is partial.</caption>
                  <thead className="bg-gray-50 text-xs text-gray-600">
                    <tr>
                      <th scope="col" className="whitespace-nowrap px-4 py-3 text-left">{interval === "day" ? "Day" : "Week starting Monday"}</th>
                      {["Images changed", "Updates", "Distinct cards", "Unknown-side updates"].map((label) => (
                        <th key={label} scope="col" className="whitespace-nowrap px-4 py-3 text-right font-medium">{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {[...periods].reverse().map((row) => (
                      <tr key={row.period}>
                        <th scope="row" className="whitespace-nowrap px-4 py-2 text-left font-normal text-gray-700">
                          {fullDate.format(calendarTime(row.period))}
                          {row.period === current && <span className="ml-2 text-xs text-blue-700">(partial)</span>}
                        </th>
                        {[row.images, row.updates, row.cards, row.unknownUpdates].map((count, index) => (
                          <td key={index} className="px-4 py-2 text-right tabular-nums text-gray-700">{number.format(count)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </div>
      ) : null}
    </section>
  );
}
