import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import type { createMessageDraft } from "@/lib/messageDraft";

export function MessageComposer({ draft, pending, onSend }: {
  draft: ReturnType<typeof createMessageDraft>;
  pending: boolean;
  onSend: () => void;
}) {
  const value = useSyncExternalStore(draft.subscribe, draft.getSnapshot, draft.getSnapshot);
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = input.current;
    // The other responsive composer is mounted but hidden. Don't measure it.
    if (!el || !el.getClientRects().length) return;
    el.style.height = "auto";
    const height = el.scrollHeight;
    el.style.height = `${Math.min(Math.max(height, 40), 120)}px`;
    el.style.overflowY = height > 120 ? "auto" : "hidden";
  }, [value]);
  return <>
    <div className="flex-1">
      <Textarea
        ref={input}
        rows={1}
        placeholder="Message..."
        aria-label="Message"
        value={value}
        onChange={e => draft.set(e.target.value)}
        className="w-full min-h-10 max-h-[120px] resize-none overflow-y-hidden px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-2xl bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-500"
        onKeyDown={e => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSend();
          }
        }}
        data-testid="input-message"
      />
    </div>
    <Button
      onClick={onSend}
      aria-label="Send message"
      data-testid="button-send-message"
      disabled={!value.trim() || pending}
      className="w-10 h-10 rounded-full bg-blue-500 hover:bg-blue-600 text-white p-0 flex-shrink-0"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
      </svg>
    </Button>
  </>;
}
