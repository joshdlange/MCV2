export const MAX_LEVEL = 50;

// XP awarded for image contributions
export const XP_PER_APPROVED_IMAGE = 10;
export const XP_FIRST_APPROVED_IMAGE_BONUS = 25;

// Default XP by badge rarity (used only if a badge has no explicit points value)
export const DEFAULT_BADGE_XP: Record<string, number> = {
  bronze: 10,
  silver: 25,
  gold: 50,
  platinum: 100,
  special: 250,
};

// Cumulative XP required to reach a given level.
// threshold(1) = 0; threshold(n) = threshold(n-1) + 100 + 50*(n-2)
// => 0, 100, 250, 450, 700, 1000, ...
export function levelThreshold(level: number): number {
  if (level <= 1) return 0;
  const capped = Math.min(level, MAX_LEVEL);
  let total = 0;
  for (let n = 2; n <= capped; n++) {
    total += 100 + 50 * (n - 2);
  }
  return total;
}

export function imageContributionXp(approvedCount: number): number {
  const approved = Math.max(0, Math.floor(approvedCount || 0));
  if (approved <= 0) return 0;
  return approved * XP_PER_APPROVED_IMAGE + XP_FIRST_APPROVED_IMAGE_BONUS;
}

export interface XpProgress {
  totalXp: number;
  level: number;
  currentLevelXp: number; // cumulative XP at the start of the current level
  nextLevelXp: number | null; // cumulative XP needed for the next level (null if maxed)
  xpIntoLevel: number; // XP earned since the current level started
  xpForNextLevel: number; // XP span of the current level (0 if maxed)
  progressPct: number; // 0-100
  isMaxLevel: boolean;
}

export function computeXpProgress(totalXp: number): XpProgress {
  const xp = Math.max(0, Math.floor(totalXp || 0));

  let level = 1;
  for (let n = 1; n <= MAX_LEVEL; n++) {
    if (xp >= levelThreshold(n)) level = n;
    else break;
  }

  const isMaxLevel = level >= MAX_LEVEL;
  const currentLevelXp = levelThreshold(level);
  const nextLevelXp = isMaxLevel ? null : levelThreshold(level + 1);
  const xpIntoLevel = xp - currentLevelXp;
  const xpForNextLevel = isMaxLevel ? 0 : nextLevelXp! - currentLevelXp;
  const progressPct = isMaxLevel
    ? 100
    : Math.min(100, Math.max(0, Math.round((xpIntoLevel / xpForNextLevel) * 100)));

  return {
    totalXp: xp,
    level,
    currentLevelXp,
    nextLevelXp,
    xpIntoLevel,
    xpForNextLevel,
    progressPct,
    isMaxLevel,
  };
}
