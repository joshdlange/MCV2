import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BookOpen, Plus, MoreVertical, Pencil, Trash2, Loader2, AlertTriangle, Crown, Star } from "lucide-react";
import { PC_BINDER_CATEGORIES } from "@shared/schema";
import { useAppStore } from "@/lib/store";
import { UpgradeModal, type UpgradeFeature } from "@/components/subscription/upgrade-modal";

export const PC_BINDER_UPGRADE_FEATURES: UpgradeFeature[] = [
  { label: "PC Binders — build custom collection sets" },
  { label: "Unlimited cards in your collection" },
  { label: "Full access to Market Trends" },
  { label: "Scan to Add" },
  { label: "Trade Block", comingSoon: true },
  { label: "Marketplace", comingSoon: true },
];

interface PcBinderSummary {
  id: number;
  name: string;
  description: string | null;
  category: string;
  createdAt: string;
  totalCards: number;
  ownedCards: number;
  coverImageUrl: string | null;
}

const binderFormSchema = z.object({
  name: z.string().trim().min(1, "Give your binder a name").max(60, "Keep it under 60 characters"),
  description: z.string().trim().max(500, "Keep it under 500 characters").optional(),
  category: z.enum(PC_BINDER_CATEGORIES),
});

type BinderFormValues = z.infer<typeof binderFormSchema>;

// Volume-chain helpers — mirror normalizeVolName/nextVolumeName in
// pc-binder-detail.tsx, where the overflow flow links binder volumes purely
// by name ("<Name> Vol. 2", "Vol. 3", ...). Requires whitespace before "vol"
// so names like "Marvol 2" aren't matched.
const VOL_SUFFIX_RE = /\s+vol\.?\s*\d+\s*$/i;

// Case/format-insensitive comparison so "Sabretooth PC Vol. 2",
// "sabretooth pc vol 2" and "Sabretooth PC Vol.2" are treated as the same name
function normalizeVolName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+vol\.?\s*(\d+)\s*$/i, " vol $1");
}

function volBaseName(name: string): string {
  return name.trim().toLowerCase().replace(VOL_SUFFIX_RE, "").trim();
}

// True when the binder is part of a "Vol. N" volume series: either its own
// name carries a Vol. N suffix, or a sibling binder is a Vol. N of this
// binder's base name (i.e. this binder is the base of a chain).
function isPartOfVolumeSeries(
  binder: PcBinderSummary,
  allBinders: PcBinderSummary[] | undefined,
): boolean {
  if (VOL_SUFFIX_RE.test(binder.name)) return true;
  if (!allBinders) return false;
  const base = volBaseName(binder.name);
  return allBinders.some(
    (b) =>
      b.id !== binder.id &&
      VOL_SUFFIX_RE.test(b.name) &&
      volBaseName(b.name) === base,
  );
}

const CATEGORY_COLORS: Record<string, string> = {
  Character: "bg-red-100 text-red-800 border-red-200",
  Artist: "bg-purple-100 text-purple-800 border-purple-200",
  Theme: "bg-blue-100 text-blue-800 border-blue-200",
  "Chase List": "bg-amber-100 text-amber-800 border-amber-200",
  Other: "bg-gray-100 text-gray-700 border-gray-200",
};

function BinderFormDialog({
  open,
  onOpenChange,
  binder,
  allBinders,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  binder: PcBinderSummary | null;
  allBinders: PcBinderSummary[] | undefined;
}) {
  const { toast } = useToast();
  const isEdit = !!binder;

  const form = useForm<BinderFormValues>({
    resolver: zodResolver(binderFormSchema),
    values: {
      name: binder?.name ?? "",
      description: binder?.description ?? "",
      category: (PC_BINDER_CATEGORIES as readonly string[]).includes(binder?.category ?? "")
        ? (binder!.category as BinderFormValues["category"])
        : "Other",
    },
  });

  const watchedName = form.watch("name");
  const showVolumeWarning =
    isEdit &&
    isPartOfVolumeSeries(binder!, allBinders) &&
    normalizeVolName(watchedName || "") !== normalizeVolName(binder!.name);

  const saveMutation = useMutation({
    mutationFn: async (values: BinderFormValues) => {
      const payload = {
        name: values.name,
        description: values.description || null,
        category: values.category,
      };
      const res = isEdit
        ? await apiRequest("PATCH", `/api/pc-binders/${binder!.id}`, payload)
        : await apiRequest("POST", "/api/pc-binders", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pc-binders"] });
      toast({ title: isEdit ? "Binder updated" : "PC Binder created!" });
      onOpenChange(false);
      form.reset();
    },
    onError: (err: any) => {
      toast({
        title: isEdit ? "Couldn't update binder" : "Couldn't create binder",
        description: err?.message || undefined,
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-red-600" />
            {isEdit ? "Edit PC Binder" : "New PC Binder"}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder='e.g. "Spider-Man PC" or "Cards I&apos;m Chasing"'
                      className="bg-white text-gray-900"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                  {showVolumeWarning && (
                    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
                      <span>
                        This binder is part of a volume series (linked by name, e.g.
                        "Vol. 2"). Renaming it disconnects it from the series — future
                        overflow volumes won't know about its cards and could repeat
                        them in a new binder.
                      </span>
                    </div>
                  )}
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="bg-white text-gray-900">
                        <SelectValue placeholder="Pick a category" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {PC_BINDER_CATEGORIES.map((cat) => (
                        <SelectItem key={cat} value={cat}>
                          {cat}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="What's this binder about?"
                      className="bg-white text-gray-900 resize-none"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type="submit"
              disabled={saveMutation.isPending}
              className="w-full bg-red-600 hover:bg-red-700"
            >
              {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              {isEdit ? "Save Changes" : "Create Binder"}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function PcBinders() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { currentUser } = useAppStore();
  const [showForm, setShowForm] = useState(false);
  const [editingBinder, setEditingBinder] = useState<PcBinderSummary | null>(null);
  const [deletingBinder, setDeletingBinder] = useState<PcBinderSummary | null>(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  const hasAccess = !!currentUser && (currentUser.plan === 'SUPER_HERO' || currentUser.isAdmin);

  const { data: binders, isLoading } = useQuery<PcBinderSummary[]>({
    queryKey: ["/api/pc-binders"],
    enabled: hasAccess,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/pc-binders/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pc-binders"] });
      toast({ title: "Binder deleted" });
      setDeletingBinder(null);
    },
    onError: () => {
      toast({ title: "Couldn't delete binder", variant: "destructive" });
    },
  });

  // Wait for user to load before deciding access.
  // NOTE: all hooks must be declared above these early returns — hasAccess can
  // flip while mounted (e.g. successful upgrade purchase from the upsell view).
  if (!currentUser) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="p-4 md:p-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <BookOpen className="w-6 h-6 text-red-600" />
          <h1 className="text-2xl font-bold text-gray-900">PC Binders</h1>
          <span className="text-[10px] font-bold tracking-wide px-1.5 py-0.5 rounded-full bg-gradient-to-r from-yellow-400 to-amber-500 text-yellow-950">
            NEW
          </span>
        </div>

        <Card className="overflow-hidden">
          <div className="bg-gradient-to-r from-yellow-400 to-amber-500 px-6 py-4 flex items-center gap-3">
            <Crown className="w-7 h-7 text-yellow-950 flex-shrink-0" />
            <div>
              <h2 className="text-lg font-bold text-yellow-950">A Super Hero Feature</h2>
              <p className="text-sm text-yellow-900">Upgrade to unlock PC Binders</p>
            </div>
          </div>
          <CardContent className="p-6 space-y-5">
            <div className="space-y-2">
              <p className="text-sm text-gray-700 leading-relaxed">
                <span className="font-semibold">PC Binders</span> let you build your own custom
                collection sets — organize cards by character, artist, theme, or a chase list of
                cards you're hunting. Track cards you own and cards you're still after, all in
                one private binder.
              </p>
            </div>

            <div className="space-y-2.5">
              <p className="text-sm font-semibold text-gray-900">Everything included with Super Hero:</p>
              {PC_BINDER_UPGRADE_FEATURES.map((feature, index) => (
                <div key={index} className="flex items-center gap-2.5">
                  <Star className="w-4 h-4 text-red-500 fill-red-500 flex-shrink-0" />
                  <span className="text-sm text-gray-800">{feature.label}</span>
                  {feature.comingSoon && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 border border-amber-400 rounded-full px-1.5 py-0.5 flex-shrink-0">
                      Coming Soon
                    </span>
                  )}
                </div>
              ))}
            </div>

            <Button
              onClick={() => setShowUpgradeModal(true)}
              className="w-full bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 text-yellow-900 font-bold py-5 rounded-xl shadow-lg transition-all duration-200"
              data-testid="button-upgrade-pc-binders"
            >
              <Crown className="w-5 h-5 mr-2" />
              Upgrade to Super Hero
            </Button>
          </CardContent>
        </Card>

        <UpgradeModal
          isOpen={showUpgradeModal}
          onClose={() => setShowUpgradeModal(false)}
          currentPlan={currentUser.plan || 'SIDE_KICK'}
          trigger="pc_binders"
          title="PC Binders is a Super Hero feature"
          description="Build custom collection sets around characters, artists, themes, or chase lists. Upgrade to Super Hero to start building your PC binders."
          features={PC_BINDER_UPGRADE_FEATURES}
        />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-red-600" />
          PC Binders
        </h1>
        <Button
          onClick={() => {
            setEditingBinder(null);
            setShowForm(true);
          }}
          className="bg-red-600 hover:bg-red-700"
        >
          <Plus className="w-4 h-4 mr-1" />
          New Binder
        </Button>
      </div>
      <p className="text-sm text-gray-600 mb-6">
        Build custom binders around characters, artists, themes, or chase lists — with cards you
        own and cards you're still hunting.
      </p>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      ) : !binders || binders.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-14 text-center">
            <BookOpen className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <h2 className="text-lg font-semibold text-gray-900 mb-1">No PC Binders yet</h2>
            <p className="text-sm text-gray-600 mb-4 max-w-sm mx-auto">
              Create your first personal collection binder — a Spider-Man PC, a favorite artist,
              or a chase list of cards you're after.
            </p>
            <Button
              onClick={() => {
                setEditingBinder(null);
                setShowForm(true);
              }}
              className="bg-red-600 hover:bg-red-700"
            >
              <Plus className="w-4 h-4 mr-1" />
              Create Your First Binder
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {binders.map((binder) => {
            const pct =
              binder.totalCards > 0
                ? Math.round((binder.ownedCards / binder.totalCards) * 100)
                : 0;
            return (
              <Card
                key={binder.id}
                className="group hover:shadow-lg transition-all duration-200"
                data-testid={`card-pc-binder-${binder.id}`}
              >
                <CardContent className="p-0">
                  <Link href={`/pc-binders/${binder.id}`} className="block">
                    <div className="relative h-40 bg-gray-100 rounded-t-lg overflow-hidden">
                      {binder.coverImageUrl ? (
                        <img
                          src={binder.coverImageUrl}
                          alt={binder.name}
                          className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-200"
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-red-100 to-red-200 flex items-center justify-center">
                          <BookOpen className="w-10 h-10 text-red-400" />
                        </div>
                      )}
                      <div className="absolute top-2 right-2">
                        <Badge
                          className={`text-white font-bold ${
                            pct === 100
                              ? "bg-green-600"
                              : pct >= 75
                              ? "bg-blue-600"
                              : pct >= 50
                              ? "bg-yellow-600"
                              : "bg-gray-600"
                          }`}
                        >
                          {pct}%
                        </Badge>
                      </div>
                    </div>
                  </Link>
                  <div className="p-4 pt-3">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/pc-binders/${binder.id}`} className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 truncate group-hover:text-red-600 transition-colors">
                        {binder.name}
                      </h3>
                    </Link>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0">
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => {
                            setEditingBinder(binder);
                            setShowForm(true);
                          }}
                        >
                          <Pencil className="w-4 h-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-red-600 focus:text-red-600"
                          onClick={() => setDeletingBinder(binder)}
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <Link href={`/pc-binders/${binder.id}`} className="block">
                    <Badge
                      variant="outline"
                      className={`mt-1 text-xs ${CATEGORY_COLORS[binder.category] || CATEGORY_COLORS.Other}`}
                    >
                      {binder.category}
                    </Badge>
                    {binder.description && (
                      <p className="text-xs text-gray-600 mt-2 line-clamp-2">{binder.description}</p>
                    )}
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                        <span>
                          {binder.ownedCards} of {binder.totalCards} owned
                        </span>
                        <span className="font-semibold">{pct}%</span>
                      </div>
                      <Progress value={pct} className="h-2" />
                    </div>
                  </Link>
                  <div className="flex gap-2 pt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-xs text-white bg-green-600 border-green-600 hover:bg-green-700 hover:text-white"
                      onClick={() => navigate(`/pc-binders/${binder.id}?filter=owned`)}
                    >
                      Owned
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-xs text-white bg-[#f73f32] border-[#f73f32] hover:bg-red-700 hover:text-white"
                      onClick={() => navigate(`/pc-binders/${binder.id}?filter=missing`)}
                    >
                      Missing
                    </Button>
                  </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <BinderFormDialog
        open={showForm}
        onOpenChange={(open) => {
          setShowForm(open);
          if (!open) setEditingBinder(null);
        }}
        binder={editingBinder}
        allBinders={binders}
      />

      <AlertDialog open={!!deletingBinder} onOpenChange={(open) => !open && setDeletingBinder(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deletingBinder?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the binder and its card list. Your main collection is not affected —
              cards you own stay in My Collection.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deletingBinder && deleteMutation.mutate(deletingBinder.id)}
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
