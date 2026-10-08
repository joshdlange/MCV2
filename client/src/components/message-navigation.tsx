import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ConversationFilter } from "@/lib/messageNavigation";

export function ConversationControls({ search, onSearch, filter, onFilter }: {
  search: string;
  onSearch: (value: string) => void;
  filter: ConversationFilter;
  onFilter: (value: ConversationFilter) => void;
}) {
  return <div className="p-3 space-y-3 border-b border-gray-200 dark:border-gray-700">
    <div className="relative">
      <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <Input aria-label="Search conversations" placeholder="Search conversations" value={search}
        onChange={event => onSearch(event.target.value)} className="pl-9" />
    </div>
    <div className="flex gap-1" aria-label="Conversation filters">
      {(["all", "unread", "friends"] as const).map(value =>
        <Button key={value} size="sm" variant={filter === value ? "secondary" : "ghost"}
          aria-pressed={filter === value} onClick={() => onFilter(value)}
          className={filter === value ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200" : ""}>
          {value.charAt(0).toUpperCase() + value.slice(1)}
        </Button>)}
    </div>
  </div>;
}

export function MessageQueryState({ loading, error, label, onRetry }: {
  loading: boolean;
  error: boolean;
  label: string;
  onRetry: () => void;
}) {
  if (error) return <div role="alert" className="p-4 text-center text-sm space-y-2">
    <p>Could not load {label}. Please try again.</p>
    <Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>
  </div>;
  if (!loading) return null;
  return <div role="status" className="p-4 space-y-4">
    <span className="sr-only">Loading {label}</span>
    {[0, 1, 2].map(index => <div key={index} className="flex gap-3 animate-pulse" aria-hidden="true">
      <div className="h-10 w-10 rounded-full bg-gray-200 dark:bg-gray-700 shrink-0" />
      <div className="flex-1 space-y-2 py-1">
        <div className="h-3 w-2/3 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-3 w-4/5 rounded bg-gray-100 dark:bg-gray-800" />
      </div>
    </div>)}
  </div>;
}
