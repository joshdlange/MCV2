import {
  Trophy,
  MessageCircle,
  Star,
  Shield,
  Crown,
  TrendingUp,
  Award,
} from "lucide-react";

const rarityStyle: Record<string, string> = {
  bronze: "bg-gradient-to-br from-amber-600 to-amber-800 border-amber-500",
  silver: "bg-gradient-to-br from-gray-400 to-gray-600 border-gray-400",
  gold: "bg-gradient-to-br from-yellow-400 to-yellow-600 border-yellow-400",
  platinum: "bg-gradient-to-br from-purple-400 to-purple-600 border-purple-400",
  special: "bg-gradient-to-br from-pink-500 to-fuchsia-700 border-pink-400",
};

const rarityGlow: Record<string, string> = {
  bronze: "shadow-lg shadow-amber-500/40",
  silver: "shadow-lg shadow-gray-400/40",
  gold: "shadow-lg shadow-yellow-400/40",
  platinum: "shadow-lg shadow-purple-400/40",
  special: "shadow-lg shadow-pink-500/40",
};

export function getRarityStyle(rarity?: string): string {
  return rarityStyle[(rarity || "bronze").toLowerCase()] ?? rarityStyle.silver;
}

export function getRarityGlow(rarity?: string): string {
  return rarityGlow[(rarity || "bronze").toLowerCase()] ?? rarityGlow.silver;
}

function FallbackIcon({ name, className }: { name: string; className: string }) {
  const n = name.toLowerCase();
  if (n.includes("collector")) return <Trophy className={className} />;
  if (n.includes("chat") || n.includes("social") || n.includes("friend")) return <MessageCircle className={className} />;
  if (n.includes("hunter") || n.includes("insert")) return <Star className={className} />;
  if (n.includes("vault") || n.includes("guardian")) return <Shield className={className} />;
  if (n.includes("hero") || n.includes("launch")) return <Crown className={className} />;
  if (n.includes("hundred") || n.includes("club")) return <TrendingUp className={className} />;
  return <Award className={className} />;
}

interface BadgeIconProps {
  name: string;
  iconUrl?: string;
  rarity?: string;
  size?: "sm" | "md" | "lg";
  glow?: boolean;
  className?: string;
}

const sizeMap = {
  sm: { box: "w-10 h-10", icon: "w-5 h-5" },
  md: { box: "w-14 h-14", icon: "w-7 h-7" },
  lg: { box: "w-20 h-20", icon: "w-10 h-10" },
};

/**
 * Shared badge visual — renders the real uploaded badge artwork (iconUrl) when
 * available, otherwise a rarity-gradient circle with a name-keyed Lucide icon.
 * Matches the Social Hub badge treatment so artwork is consistent app-wide.
 */
export default function BadgeIcon({
  name,
  iconUrl,
  rarity,
  size = "md",
  glow = false,
  className = "",
}: BadgeIconProps) {
  const dims = sizeMap[size];

  if (iconUrl) {
    return (
      <div className={`${dims.box} rounded-full overflow-hidden border-2 ${getRarityStyle(rarity)} ${glow ? getRarityGlow(rarity) : ""} ${className}`}>
        <img src={iconUrl} alt={name} className="w-full h-full object-cover" />
      </div>
    );
  }

  return (
    <div className={`${dims.box} rounded-full flex items-center justify-center border-2 ${getRarityStyle(rarity)} ${glow ? getRarityGlow(rarity) : ""} ${className}`}>
      <FallbackIcon name={name} className={`${dims.icon} text-white`} />
    </div>
  );
}
