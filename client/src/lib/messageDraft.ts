// Only the composers subscribe. Typing must not redraw the full Social page.
export function createMessageDraft() {
  let value = "";
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    set(next: string) {
      if (next === value) return;
      value = next;
      listeners.forEach(listener => listener());
    },
    clearIfSent(sent: string) {
      if (value.trim() === sent) this.set("");
    },
  };
}
