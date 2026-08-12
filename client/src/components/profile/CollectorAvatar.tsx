import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { avatarUrl } from "@/lib/collectorAvatars";
import { cn } from "@/lib/utils";

interface CollectorAvatarProps {
  /** Selected collector avatar key (users.collectorAvatarKey) — wins over photoUrl */
  avatarKey?: string | null;
  /** Legacy/auth photo URL fallback */
  photoUrl?: string | null;
  /** Name used for the initial fallback */
  name?: string | null;
  /** Pixel size (rendered square). Defaults to 40. */
  size?: number;
  className?: string;
  /** Red glow ring for premium contexts (profile headers, pickers) */
  glow?: boolean;
}

/**
 * Reusable collector identity avatar. Used anywhere a collector appears:
 * nav chip, profile pages, and future feed posts / follows / leaderboards.
 * Circular, crisp at small sizes (512px masters, browser downscales).
 */
export function CollectorAvatar({
  avatarKey,
  photoUrl,
  name,
  size = 40,
  className,
  glow = false,
}: CollectorAvatarProps) {
  const src = avatarUrl(avatarKey) ?? photoUrl ?? undefined;
  const initial = (name || "C").trim().charAt(0).toUpperCase();
  return (
    <Avatar
      className={cn(
        "shrink-0",
        glow && "ring-2 ring-red-600/70 shadow-[0_0_12px_rgba(220,38,38,0.45)]",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <AvatarImage referrerPolicy="no-referrer" src={src} alt={name ? `${name}'s avatar` : "Collector avatar"} draggable={false} />
      <AvatarFallback
        className="bg-red-600 text-white font-bold"
        style={{ fontSize: Math.max(11, Math.round(size * 0.42)) }}
      >
        {initial}
      </AvatarFallback>
    </Avatar>
  );
}

export default CollectorAvatar;
