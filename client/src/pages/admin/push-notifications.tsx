import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Bell, Smartphone, TabletSmartphone, Users, Rocket, Send, RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/lib/store";

const TITLE_MAX = 65;
const BODY_MAX = 240;

type Target = "all" | "superhero" | "sidekick" | "user";

const TARGET_LABELS: Record<string, string> = {
  all: "All Users",
  superhero: "Super Hero subscribers",
  sidekick: "Side Kick subscribers",
};

function targetLabel(target: string): string {
  if (target.startsWith("user:")) return `User #${target.slice(5)}`;
  return TARGET_LABELS[target] || target;
}

export default function AdminPushNotifications() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { currentUser } = useAppStore();

  const [target, setTarget] = useState<Target>("all");
  const [userId, setUserId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data: stats, isLoading: statsLoading } = useQuery<any>({
    queryKey: ["/api/admin/push/stats"],
  });
  const { data: logs, isLoading: logsLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/push/logs"],
  });

  const sendMutation = useMutation({
    mutationFn: async (payload: { target: Target; userId?: number; username?: string; title: string; body: string; isTest?: boolean }) => {
      const res = await apiRequest("POST", "/api/admin/push/send", {
        target: payload.target,
        userId: payload.userId,
        username: payload.username,
        title: payload.title,
        body: payload.body,
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Send failed");
      return { ...data, isTest: payload.isTest };
    },
    onSuccess: (data: any) => {
      toast({
        title: data.isTest ? "Test push sent" : "Push notification sent",
        description: `Delivered to ${data.sent} device(s)${data.failed ? `, ${data.failed} failed` : ""}.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/push/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/push/logs"] });
      if (!data.isTest) {
        setTitle("");
        setBody("");
      }
    },
    onError: (err: any) => {
      toast({ title: "Send failed", description: err?.message || "Check the server logs.", variant: "destructive" });
    },
    onSettled: () => setConfirmOpen(false),
  });

  const formValid =
    title.trim().length > 0 && title.length <= TITLE_MAX &&
    body.trim().length > 0 && body.length <= BODY_MAX &&
    (target !== "user" || userId.trim().length > 0);

  const handleSendClick = () => {
    if (!formValid) return;
    if (target === "user") {
      const entry = userId.trim();
      // Numeric input = user ID; anything else = username
      if (/^\d+$/.test(entry)) {
        sendMutation.mutate({ target: "user", userId: parseInt(entry), title, body });
      } else {
        sendMutation.mutate({ target: "user", username: entry, title, body });
      }
    } else {
      setConfirmOpen(true); // segment sends need confirmation
    }
  };

  const handleTestSend = () => {
    if (!(title.trim() && body.trim())) {
      toast({ title: "Add a title and message first", variant: "destructive" });
      return;
    }
    if (!currentUser?.id) {
      toast({ title: "Couldn't determine your account", variant: "destructive" });
      return;
    }
    // Test = target 'user' with the logged-in admin's own id (no confirm modal)
    sendMutation.mutate({ target: "user", userId: currentUser.id, title, body, isTest: true });
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-orange-500">
          <Bell className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Push Notifications</h1>
          <p className="text-sm text-gray-500">Send app push notifications to collectors' devices (manual sends only)</p>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Registered Devices", value: stats?.totalTokens, icon: Bell },
          { label: "iOS Devices", value: stats?.iosTokens, icon: Smartphone },
          { label: "Android Devices", value: stats?.androidTokens, icon: TabletSmartphone },
          { label: "Users Opted In", value: stats?.usersWithTokens, icon: Users },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label} className="border border-gray-200">
            <CardContent className="p-4 flex items-center gap-3">
              <Icon className="h-4 w-4 text-gray-400 shrink-0" />
              <div>
                <div className="text-lg font-bold text-gray-900 dark:text-white">
                  {statsLoading ? "…" : (value ?? 0)}
                </div>
                <div className="text-xs text-gray-500">{label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Composer */}
      <Card className="border border-gray-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Send Push Notification</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs font-medium text-gray-700 dark:text-gray-300">Target</Label>
            <RadioGroup value={target} onValueChange={(v) => setTarget(v as Target)} className="mt-2 space-y-1">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="all" id="t-all" />
                <Label htmlFor="t-all" className="text-sm font-normal">All Users</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="superhero" id="t-sh" />
                <Label htmlFor="t-sh" className="text-sm font-normal">Super Hero subscribers only</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="sidekick" id="t-sk" />
                <Label htmlFor="t-sk" className="text-sm font-normal">Side Kick subscribers only</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="user" id="t-user" />
                <Label htmlFor="t-user" className="text-sm font-normal">Single User</Label>
                {target === "user" && (
                  <Input
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                    placeholder="Username or user ID"
                    className="h-8 w-44 text-sm"
                  />
                )}
              </div>
            </RadioGroup>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-gray-700 dark:text-gray-300">Title</Label>
              <span className={`text-xs ${title.length > TITLE_MAX ? "text-red-600" : "text-gray-400"}`}>
                {title.length}/{TITLE_MAX}
              </span>
            </div>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
              placeholder="e.g. New cards just dropped!"
              className="mt-1"
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-gray-700 dark:text-gray-300">Message</Label>
              <span className={`text-xs ${body.length > BODY_MAX ? "text-red-600" : "text-gray-400"}`}>
                {body.length}/{BODY_MAX}
              </span>
            </div>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, BODY_MAX))}
              placeholder="What do you want collectors to see?"
              rows={3}
              className="mt-1"
            />
          </div>

          <div className="flex flex-wrap gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTestSend}
              disabled={sendMutation.isPending || !title.trim() || !body.trim()}
            >
              <Send className="h-3.5 w-3.5 mr-1.5" />
              Send Test to My Account
            </Button>
            <Button
              size="sm"
              onClick={handleSendClick}
              disabled={sendMutation.isPending || !formValid}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              <Rocket className="h-3.5 w-3.5 mr-1.5" />
              Send Push Notification
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* History */}
      <Card className="border border-gray-200">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Recent Push Notification History</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/admin/push/logs"] });
              queryClient.invalidateQueries({ queryKey: ["/api/admin/push/stats"] });
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </CardHeader>
        <CardContent>
          {logsLoading ? (
            <p className="text-sm text-gray-500 py-4">Loading…</p>
          ) : !logs || logs.length === 0 ? (
            <p className="text-sm text-gray-500 py-4">No push notifications sent yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Sent By</TableHead>
                    <TableHead className="text-xs">Target</TableHead>
                    <TableHead className="text-xs">Title</TableHead>
                    <TableHead className="text-xs text-right">Sent</TableHead>
                    <TableHead className="text-xs text-right">Failed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log: any) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs">
                        {log.sent_by_display_name || log.sent_by_username || "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="outline" className="text-xs">{targetLabel(log.target)}</Badge>
                      </TableCell>
                      <TableCell className="text-xs max-w-[220px] truncate" title={log.body}>
                        {log.title}
                      </TableCell>
                      <TableCell className="text-xs text-right">{log.sent_count}</TableCell>
                      <TableCell className="text-xs text-right text-red-600">
                        {log.failed_count > 0 ? log.failed_count : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Segment-send confirmation */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send to {TARGET_LABELS[target] || target}?</DialogTitle>
            <DialogDescription>
              This sends a real push notification to every registered device in this group. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border p-3 text-sm space-y-1 bg-gray-50 dark:bg-gray-900">
            <div className="font-semibold">{title}</div>
            <div className="text-gray-600 dark:text-gray-300">{body}</div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={sendMutation.isPending}>
              Cancel
            </Button>
            <Button
              className="bg-orange-600 hover:bg-orange-700 text-white"
              disabled={sendMutation.isPending}
              onClick={() => sendMutation.mutate({ target, title, body })}
            >
              {sendMutation.isPending ? "Sending…" : "Yes, send it"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
