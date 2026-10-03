export interface ScanEventUpdate {
  pickedCardId?: number;
  usedSearch?: true;
  photoSubmitUsed?: true;
  totalMs?: number;
}

// One recorder belongs to one scan epoch. Serialize partial updates so a slower
// earlier selection cannot overwrite a later selection. Never resend defaults.
export function createScanEventRecorder(
  eventId: string,
  request: (path: string, update: ScanEventUpdate) => Promise<unknown>,
  isCurrent: () => boolean,
  onError: () => void,
) {
  let queue = Promise.resolve();
  let warned = false;
  return {
    record(update: ScanEventUpdate): void {
      // Accepted updates belong to this immutable event ID even when fast repeat
      // capture advances the epoch before the network queue drains.
      if (!isCurrent()) return;
      const snapshot = { ...update };
      queue = queue.then(async () => {
        try {
          await request(`/api/cards/scan/events/${encodeURIComponent(eventId)}`, snapshot);
        } catch {
          if (isCurrent() && !warned) {
            warned = true;
            onError();
          }
        }
      });
    },
  };
}