/** Only the enabled development scan may retain an already-verified session. */
export function canRefreshScanSessionInPlace(
  development: boolean, visualEnabled: boolean,
  verifiedUid: string | null, incomingUid: string | undefined,
): boolean {
  return development && visualEnabled && !!verifiedUid && verifiedUid === incomingUid;
}