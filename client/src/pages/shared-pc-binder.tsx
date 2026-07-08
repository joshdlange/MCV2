import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { motion } from "framer-motion";
import { BookOpen, Copy, Check, Sparkles } from "lucide-react";
import { SiFacebook, SiX, SiReddit, SiInstagram } from "react-icons/si";
import { formatCardName } from "@/lib/formatTitle";
import marvelCardVaultLogo from "@assets/Marvelous_Card_Valut_-_Trans_1772678671637.png";

interface SharedPcCard {
  id: number;
  name: string;
  cardNumber: string;
  frontImageUrl: string | null;
  isInsert: boolean;
  setName: string | null;
}

interface SharedPcBinderData {
  sharerName: string;
  binder: {
    name: string;
    description: string | null;
    category: string;
  };
  cards: SharedPcCard[];
  ownedCardIds: number[];
  stats: {
    totalCards: number;
    ownedCount: number;
  };
}

const PLACEHOLDER_IMAGE = 'https://res.cloudinary.com/dlwfuryyz/image/upload/v1748442577/card-placeholder_ysozlo.png';

function SharedPcCardTile({ card, owned, index }: { card: SharedPcCard; owned: boolean; index: number }) {
  const imageUrl = card.frontImageUrl && card.frontImageUrl !== PLACEHOLDER_IMAGE ? card.frontImageUrl : null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: Math.min(index, 30) * 0.02, duration: 0.2 }}
      className={`relative rounded-lg overflow-hidden
        ${owned
          ? 'ring-2 ring-red-500/40 shadow-lg shadow-red-500/10'
          : 'ring-1 ring-gray-700/40'
        }
      `}
      style={{
        aspectRatio: '2.5 / 3.5',
        background: owned
          ? 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)'
          : 'linear-gradient(135deg, #1a1a1a 0%, #111 100%)'
      }}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={card.name}
          className={`w-full h-full object-cover ${!owned ? 'grayscale opacity-40' : ''}`}
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center p-2 text-center">
          <img
            src={marvelCardVaultLogo}
            alt="Marvelous Card Vault"
            className={`w-10 h-10 mb-1 ${!owned ? 'grayscale opacity-30' : 'opacity-60'}`}
          />
          <span className={`text-[10px] font-medium leading-tight line-clamp-2 ${owned ? 'text-gray-400' : 'text-gray-600'}`}>
            {card.name}
          </span>
        </div>
      )}

      {owned && card.isInsert && (
        <div className="absolute top-1 right-1 bg-purple-600/90 text-white rounded-full w-5 h-5 flex items-center justify-center shadow-lg">
          <Sparkles className="w-3 h-3" />
        </div>
      )}

      <div className="absolute bottom-1 left-1">
        {owned ? (
          <span className="bg-green-600/90 text-white text-[9px] px-1.5 py-0.5 rounded font-bold shadow-lg">
            OWNED
          </span>
        ) : (
          <span className="bg-amber-500/90 text-black text-[9px] px-1.5 py-0.5 rounded font-bold shadow-lg">
            CHASING
          </span>
        )}
      </div>

      <div className="absolute inset-0 pointer-events-none rounded-lg"
        style={{ boxShadow: 'inset 0 0 15px rgba(0,0,0,0.5), inset 0 2px 4px rgba(255,255,255,0.03)' }}
      />
    </motion.div>
  );
}

function SocialShareButtons({ shareUrl, binderName, sharerName }: { shareUrl: string; binderName: string; sharerName: string }) {
  const [copied, setCopied] = useState(false);
  const shareMessage = `BEHOLD ${sharerName}'s ${binderName} PC binder! ${shareUrl}\n\nTrack your collection and its value at marvelcardvault.com`;
  const headline = `BEHOLD ${sharerName}'s ${binderName} PC binder!\n\nTrack your collection and its value at marvelcardvault.com`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  return (
    <div className="flex items-center justify-center gap-3">
      <button
        onClick={() => window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}&quote=${encodeURIComponent(headline)}`, "_blank", "noopener,noreferrer,width=600,height=400")}
        className="w-10 h-10 rounded-full bg-[#1877F2]/20 hover:bg-[#1877F2]/40 text-[#1877F2] flex items-center justify-center transition-colors border border-[#1877F2]/30"
        title="Share on Facebook"
      >
        <SiFacebook className="w-4 h-4" />
      </button>
      <button
        onClick={() => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(headline)}&url=${encodeURIComponent(shareUrl)}`, "_blank", "noopener,noreferrer,width=600,height=400")}
        className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors border border-white/20"
        title="Share on X"
      >
        <SiX className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => window.open(`https://www.reddit.com/submit?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(`BEHOLD ${sharerName}'s ${binderName} PC binder!`)}`, "_blank", "noopener,noreferrer")}
        className="w-10 h-10 rounded-full bg-[#FF4500]/20 hover:bg-[#FF4500]/40 text-[#FF4500] flex items-center justify-center transition-colors border border-[#FF4500]/30"
        title="Share on Reddit"
      >
        <SiReddit className="w-4 h-4" />
      </button>
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(shareMessage);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
            window.open("https://www.instagram.com/", "_blank", "noopener,noreferrer");
          } catch { /* ignore */ }
        }}
        className="w-10 h-10 rounded-full bg-gradient-to-br from-[#833AB4]/20 via-[#FD1D1D]/20 to-[#F77737]/20 hover:from-[#833AB4]/40 hover:via-[#FD1D1D]/40 hover:to-[#F77737]/40 text-pink-400 flex items-center justify-center transition-colors border border-pink-500/30"
        title="Copy link & open Instagram"
      >
        <SiInstagram className="w-4 h-4" />
      </button>
      <button
        onClick={handleCopyLink}
        className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors border border-white/20"
        title="Copy share message"
      >
        {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
      </button>
    </div>
  );
}

export default function SharedPcBinder() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [view, setView] = useState<"all" | "owned" | "chasing">("all");

  const { data, isLoading, error } = useQuery<SharedPcBinderData>({
    queryKey: [`/api/pc-share/${token}`],
    enabled: !!token,
    retry: false,
  });

  const ownedSet = useMemo(() => new Set(data?.ownedCardIds ?? []), [data]);

  const visibleCards = useMemo(() => {
    if (!data) return [];
    if (view === "all") return data.cards;
    return data.cards.filter((c) => (view === "owned" ? ownedSet.has(c.id) : !ownedSet.has(c.id)));
  }, [data, view, ownedSet]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <img src={marvelCardVaultLogo} alt="Marvelous Card Vault" className="w-24 h-24 mx-auto mb-6 animate-pulse" />
          <div className="animate-spin w-8 h-8 border-3 border-red-600 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-400 text-sm">Loading PC binder...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    const is410 = (error as any)?.message?.includes("revoked") || (error as any)?.status === 410;
    return (
      <div className="min-h-screen bg-black flex flex-col">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-red-500 to-transparent" />
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center max-w-md">
            <img src={marvelCardVaultLogo} alt="Marvelous Card Vault" className="w-32 h-32 mx-auto mb-6" />
            <BookOpen className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-white mb-2">
              {is410 ? "Link No Longer Active" : "Binder Not Found"}
            </h1>
            <p className="text-gray-400 mb-8">
              {is410
                ? "The owner has revoked this share link."
                : "This share link doesn't exist or may have been removed."}
            </p>
            <a
              href="https://app.marvelcardvault.com"
              className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-8 py-3 rounded-lg font-bold transition-colors shadow-lg shadow-red-600/30"
            >
              Track Your Own Collection
            </a>
          </div>
        </div>
      </div>
    );
  }

  const { binder, stats, sharerName } = data;
  const completionPct = stats.totalCards > 0
    ? Math.round((stats.ownedCount / stats.totalCards) * 100)
    : 0;
  const chasingCount = stats.totalCards - stats.ownedCount;
  const shareUrl = `https://app.marvelcardvault.com/pc-share/${token}`;

  return (
    <div className="min-h-screen bg-black flex flex-col relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-red-900/10 via-black to-red-950/5 pointer-events-none" />
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-red-500 to-transparent" />

      <div className="relative z-10 px-4 pt-8 pb-4">
        <div className="max-w-lg mx-auto text-center">
          <img
            src={marvelCardVaultLogo}
            alt="Marvelous Card Vault"
            className="w-28 h-28 lg:w-36 lg:h-36 mx-auto mb-4"
          />

          <p className="text-red-400 text-sm font-semibold tracking-wider uppercase mb-1">
            {sharerName}'s PC Binder
          </p>
          <h1 className="text-2xl lg:text-3xl font-bebas text-white tracking-wider leading-tight mb-1">
            {binder.name}
          </h1>
          <span className="inline-block text-[11px] font-semibold tracking-wide uppercase text-red-300 bg-red-950/60 border border-red-800/50 rounded-full px-3 py-0.5">
            {binder.category}
          </span>
          {binder.description && (
            <p className="text-gray-400 text-sm mt-2 max-w-sm mx-auto">{binder.description}</p>
          )}

          <div className="flex items-center justify-center gap-3 mt-4">
            <div className="flex items-center gap-2">
              <span className="text-green-400 font-bold text-lg">{stats.ownedCount}</span>
              <span className="text-gray-500 text-sm">of</span>
              <span className="text-white font-bold text-lg">{stats.totalCards}</span>
              <span className="text-gray-500 text-sm">collected</span>
            </div>
          </div>
          <div className="max-w-xs mx-auto mt-2">
            <div className="bg-gray-800 rounded-full h-2.5 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${completionPct}%`,
                  background: completionPct === 100
                    ? 'linear-gradient(90deg, #22c55e, #16a34a)'
                    : 'linear-gradient(90deg, #dc2626, #ef4444)'
                }}
              />
            </div>
            <p className="text-center mt-1.5">
              <span className={`text-sm font-bold ${completionPct === 100 ? 'text-green-400' : 'text-red-400'}`}>
                {completionPct}% complete
              </span>
            </p>
          </div>

          <a
            href="https://app.marvelcardvault.com"
            className="inline-flex items-center gap-2 mt-5 bg-red-600 hover:bg-red-700 text-white px-6 py-2.5 rounded-lg font-bold text-sm transition-colors shadow-lg shadow-red-600/20"
          >
            Track Your Collection
          </a>
        </div>
      </div>

      <div className="relative z-10 flex-1 max-w-3xl mx-auto w-full px-4 py-4">
        {data.cards.length === 0 ? (
          <div className="text-center py-12">
            <BookOpen className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400 text-lg">This binder is empty for now.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-center gap-2 mb-4">
              {([
                ["all", `All (${stats.totalCards})`],
                ["owned", `Owned (${stats.ownedCount})`],
                ["chasing", `Chasing (${chasingCount})`],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setView(key)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors border
                    ${view === key
                      ? 'bg-red-600 text-white border-red-500'
                      : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'
                    }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {visibleCards.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-10">Nothing here yet.</p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2.5">
                {visibleCards.map((card, i) => (
                  <div key={card.id}>
                    <SharedPcCardTile card={card} owned={ownedSet.has(card.id)} index={i} />
                    <p className="text-gray-500 text-[10px] mt-1 text-center truncate px-0.5">
                      {formatCardName(card.name)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div className="mt-8 text-center">
          <p className="text-xs text-gray-500 mb-3 tracking-wider uppercase">Share this binder</p>
          <SocialShareButtons shareUrl={shareUrl} binderName={binder.name} sharerName={sharerName} />
        </div>
      </div>

      <div className="relative z-10 mt-auto">
        <div className="border-t border-red-900/30">
          <div
            className="px-4 py-10"
            style={{
              background: 'linear-gradient(180deg, rgba(127, 29, 29, 0.15) 0%, rgba(0,0,0,0.9) 100%)',
            }}
          >
            <div className="max-w-lg mx-auto text-center">
              <h2 className="text-white font-bebas text-3xl tracking-wider mb-2">Start Your Collection</h2>
              <p className="text-gray-400 text-sm mb-6 max-w-sm mx-auto">
                Track your Marvel cards, build your own PC binders, and share them with friends.
              </p>
              <a
                href="https://app.marvelcardvault.com"
                className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-10 py-3.5 rounded-lg font-bold text-lg transition-colors shadow-lg shadow-red-600/30"
              >
                Create Your Free Account
              </a>
              <p className="text-gray-600 text-xs mt-5">
                marvelcardvault.com
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
