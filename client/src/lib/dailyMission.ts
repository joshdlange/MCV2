export type Mission = {
  headline: string;
  copy: string;
  cta: string;
  href?: string;
  review?: boolean;
};

interface MissionStats {
  totalCards: number;
  wishlistItems?: number;
  wishlistCount?: number;
}

interface MissionXp {
  isMaxLevel: boolean;
  progressPct: number;
  xpForNextLevel: number;
  xpIntoLevel: number;
  level: number;
}

const BUILD_YOUR_VAULT: Mission = {
  headline: "Build Your Vault",
  copy: "Every card you add grows your collection value, earns XP, and helps complete your binders.",
  cta: "Add Cards",
};

const SHOW_OFF_YOUR_PC: Mission = {
  headline: "Show Off Your PC",
  copy: "Build a PC binder of your favorite cards and share it — every view shows off your collection to the community.",
  cta: "Open PC Binders",
  href: "/pc-binders",
};

const POWER_THE_ARCHIVE: Mission = {
  headline: "Power the Archive",
  copy: "Spot a card missing its image? Upload yours to earn XP and help every collector who owns it.",
  cta: "Browse Cards",
};

const REVIEW_THE_APP: Mission = {
  headline: "Help the Vault",
  copy: "Using the iPhone or Android app? Leave us a review. It helps more collectors find MCV and keeps us building the features you've requested.",
  cta: "Leave a Review",
  review: true,
};

const EVERGREEN: Mission[] = [
  BUILD_YOUR_VAULT,
  SHOW_OFF_YOUR_PC,
  POWER_THE_ARCHIVE,
];

function todaysEvergreen(): Mission {
  const dayIndex = Math.floor(Date.now() / 86_400_000);
  return EVERGREEN[dayIndex % EVERGREEN.length];
}

export function pickMission(
  stats: MissionStats,
  xp: MissionXp | undefined,
  totalLogins = 0,
): Mission {
  const totalCards = stats.totalCards || 0;

  // Show this for the user's fourth tracked login day only. The badge remains
  // independently earned from native launches; opening a store is optional.
  if (totalLogins === 4) {
    return REVIEW_THE_APP;
  }

  const wishlistRaw = stats.wishlistItems ?? stats.wishlistCount;
  const wishlistKnown = typeof wishlistRaw === "number" && !isNaN(wishlistRaw);

  if (totalCards < 10) {
    return BUILD_YOUR_VAULT;
  }

  if (!wishlistKnown) {
    return todaysEvergreen();
  }

  if (wishlistRaw === 0) {
    return {
      headline: "Start Your Wishlist",
      copy: "Track the cards you're chasing and get ready for future trades.",
      cta: "Browse Cards",
    };
  }

  if (xp && !xp.isMaxLevel && xp.progressPct >= 60) {
    const remaining = Math.max(0, xp.xpForNextLevel - xp.xpIntoLevel);
    return {
      headline: "Level Up",
      copy: `You're ${remaining.toLocaleString()} XP from Level ${xp.level + 1}. Add cards, earn Super Powers, or contribute images to power up.`,
      cta: "Continue Building",
    };
  }

  return todaysEvergreen();
}