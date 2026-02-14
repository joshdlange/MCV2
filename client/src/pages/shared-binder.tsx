import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Sparkles, BookOpen, Copy, Check } from "lucide-react";
import { SiFacebook, SiX, SiReddit, SiInstagram } from "react-icons/si";
import { formatSetName } from "@/lib/formatTitle";
import marvelCardVaultLogo from "@assets/Marvel_Card_Vault_Logo_Small_1771104300526.png";

interface SharePageCard {
  id: number;
  cardNumber: string;
  name: string;
  frontImageUrl: string | null;
  isInsert: boolean;
  rarity: string;
  variation: string | null;
}

interface SharePageData {
  sharerName: string;
  setInfo: {
    id: number;
    name: string;
    slug: string;
    year: number;
    imageUrl: string | null;
    totalCards: number;
    mainSetId: number | null;
    mainSetName: string | null;
    mainSetSlug: string | null;
  };
  cards: SharePageCard[];
  ownedCardIds: number[];
  stats: {
    totalCards: number;
    ownedCount: number;
  };
}

const PLACEHOLDER_IMAGE = 'https://res.cloudinary.com/dlwfuryyz/image/upload/v1748442577/card-placeholder_ysozlo.png';

function SharedBinderSlot({ card, owned, slotIndex }: { card: SharePageCard; owned: boolean; slotIndex: number }) {
  const imageUrl = card.frontImageUrl && card.frontImageUrl !== PLACEHOLDER_IMAGE ? card.frontImageUrl : null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: slotIndex * 0.03, duration: 0.2 }}
      className={`relative rounded-lg overflow-hidden w-full
        ${owned
          ? 'ring-2 ring-red-500/40 shadow-lg shadow-red-500/10'
          : 'ring-1 ring-gray-700/40 opacity-50'
        }
      `}
      style={{
        aspectRatio: '2 / 3',
        background: owned
          ? 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)'
          : 'linear-gradient(135deg, #1a1a1a 0%, #111 100%)'
      }}
    >
      {imageUrl ? (
        <div className="relative w-full h-full">
          <img
            src={imageUrl}
            alt={`Card #${card.cardNumber}`}
            className={`w-full h-full object-cover ${!owned ? 'grayscale opacity-30' : ''}`}
            loading="lazy"
          />
          {owned && card.isInsert && (
            <div className="absolute bottom-1 left-1 bg-purple-600/90 text-white rounded-full w-5 h-5 flex items-center justify-center shadow-lg">
              <Sparkles className="w-3 h-3" />
            </div>
          )}
          {owned && (
            <div className="absolute bottom-1 right-1 bg-red-600/90 text-white text-[8px] px-1 py-0.5 rounded font-bold shadow-lg">
              #{card.cardNumber}
            </div>
          )}
        </div>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center p-2 text-center">
          <img
            src={marvelCardVaultLogo}
            alt="Marvel Card Vault"
            className={`w-10 h-10 mb-1 ${!owned ? 'grayscale opacity-30' : 'opacity-60'}`}
          />
          <span className={`text-[10px] font-medium leading-tight ${owned ? 'text-gray-400' : 'text-gray-600'}`}>
            #{card.cardNumber}
          </span>
          {owned && (
            <span className="text-[8px] text-gray-500 leading-tight mt-0.5 line-clamp-2">
              {card.name}
            </span>
          )}
        </div>
      )}

      <div className="absolute inset-0 pointer-events-none rounded-lg"
        style={{
          boxShadow: 'inset 0 0 15px rgba(0,0,0,0.5), inset 0 2px 4px rgba(255,255,255,0.03)'
        }}
      />
    </motion.div>
  );
}

function SocialShareButtons({ shareUrl, setName, sharerName, mainSetName }: { shareUrl: string; setName: string; sharerName: string; mainSetName?: string | null }) {
  const [copied, setCopied] = useState(false);
  const displayName = (() => {
    if (!mainSetName) return setName;
    let subsetPart = setName;
    if (setName.startsWith(mainSetName + " - ")) {
      subsetPart = setName.slice(mainSetName.length + 3).trim();
    } else if (setName === mainSetName) {
      subsetPart = "Base";
    }
    return `${mainSetName} - ${subsetPart}`;
  })();
  const shareMessage = `BEHOLD ${sharerName}'s collection of ${displayName}! ${shareUrl}\n\nTrack your collection and its value at marvelcardvault.com`;

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
        onClick={() => window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}&quote=${encodeURIComponent(`BEHOLD ${sharerName}'s collection of ${displayName}!\n\nTrack your collection and its value at marvelcardvault.com`)}`, "_blank", "noopener,noreferrer,width=600,height=400")}
        className="w-10 h-10 rounded-full bg-[#1877F2]/20 hover:bg-[#1877F2]/40 text-[#1877F2] flex items-center justify-center transition-colors border border-[#1877F2]/30"
        title="Share on Facebook"
      >
        <SiFacebook className="w-4 h-4" />
      </button>
      <button
        onClick={() => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(`BEHOLD ${sharerName}'s collection of ${displayName}!\n\nTrack your collection and its value at marvelcardvault.com`)}&url=${encodeURIComponent(shareUrl)}`, "_blank", "noopener,noreferrer,width=600,height=400")}
        className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors border border-white/20"
        title="Share on X"
      >
        <SiX className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => window.open(`https://www.reddit.com/submit?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(`BEHOLD ${sharerName}'s collection of ${displayName}!`)}`, "_blank", "noopener,noreferrer")}
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

export default function SharedBinder() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [currentPage, setCurrentPage] = useState(0);
  const [flipDirection, setFlipDirection] = useState<"left" | "right">("right");
  const cardsPerPage = 9;

  const { data, isLoading, error } = useQuery<SharePageData>({
    queryKey: [`/api/share/${token}`],
    enabled: !!token,
    retry: false,
  });

  const ownedSet = useMemo(() => {
    if (!data) return new Set<number>();
    return new Set(data.ownedCardIds);
  }, [data]);

  const sortedCards = useMemo(() => {
    if (!data) return [];
    return [...data.cards]
      .sort((a, b) => {
        const aStr = a.cardNumber?.trim() || '';
        const bStr = b.cardNumber?.trim() || '';
        const aParts = aStr.match(/^([A-Za-z-]*?)(\d+)(.*)$/);
        const bParts = bStr.match(/^([A-Za-z-]*?)(\d+)(.*)$/);
        if (aParts && bParts) {
          const prefixCmp = aParts[1].localeCompare(bParts[1]);
          if (prefixCmp !== 0) return prefixCmp;
          const numCmp = parseInt(aParts[2]) - parseInt(bParts[2]);
          if (numCmp !== 0) return numCmp;
          return (aParts[3] || '').localeCompare(bParts[3] || '');
        }
        return aStr.localeCompare(bStr);
      });
  }, [data]);

  const ownedCards = useMemo(() => sortedCards.filter(c => ownedSet.has(c.id)), [sortedCards, ownedSet]);

  const totalPages = Math.ceil(ownedCards.length / cardsPerPage);
  const currentCards = ownedCards.slice(
    currentPage * cardsPerPage,
    (currentPage + 1) * cardsPerPage
  );

  const handlePageChange = (direction: "prev" | "next") => {
    if (direction === "prev" && currentPage > 0) {
      setFlipDirection("left");
      setCurrentPage(prev => prev - 1);
    } else if (direction === "next" && currentPage < totalPages - 1) {
      setFlipDirection("right");
      setCurrentPage(prev => prev + 1);
    }
  };

  const pageVariants = {
    enter: (direction: "left" | "right") => ({
      rotateY: direction === "right" ? 90 : -90,
      opacity: 0,
      scale: 0.9
    }),
    center: { rotateY: 0, opacity: 1, scale: 1 },
    exit: (direction: "left" | "right") => ({
      rotateY: direction === "right" ? -90 : 90,
      opacity: 0,
      scale: 0.9
    })
  };

  const navButton = (direction: "prev" | "next") => (
    <button
      onClick={() => handlePageChange(direction)}
      disabled={direction === "prev" ? currentPage === 0 : currentPage >= totalPages - 1}
      className="bg-red-600/20 text-red-400 disabled:opacity-20 disabled:cursor-not-allowed h-10 w-10 rounded-full flex items-center justify-center border border-red-500/30 hover:bg-red-600/40 transition-colors"
    >
      {direction === "prev" ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
    </button>
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <img src={marvelCardVaultLogo} alt="Marvel Card Vault" className="w-24 h-24 mx-auto mb-6 animate-pulse" />
          <div className="animate-spin w-8 h-8 border-3 border-red-600 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-400 text-sm">Loading binder...</p>
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
            <img src={marvelCardVaultLogo} alt="Marvel Card Vault" className="w-32 h-32 mx-auto mb-6" />
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

  const { setInfo, stats, sharerName } = data;
  const displaySetName = formatSetName(setInfo.name);
  const fullDisplayName = (() => {
    if (!setInfo.mainSetName) return displaySetName;
    let subsetPart = displaySetName;
    if (displaySetName.startsWith(setInfo.mainSetName + " - ")) {
      subsetPart = displaySetName.slice(setInfo.mainSetName.length + 3).trim();
    } else if (displaySetName === setInfo.mainSetName) {
      subsetPart = "Base";
    }
    return `${setInfo.mainSetName} - ${subsetPart}`;
  })();
  const completionPct = stats.totalCards > 0
    ? Math.round((stats.ownedCount / stats.totalCards) * 100)
    : 0;
  const shareUrl = `https://app.marvelcardvault.com/share/${token}`;

  return (
    <div className="min-h-screen bg-black flex flex-col relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-red-900/10 via-black to-red-950/5 pointer-events-none" />
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-red-500 to-transparent" />

      <div className="relative z-10 px-4 pt-8 pb-4">
        <div className="max-w-lg mx-auto text-center">
          <img
            src={marvelCardVaultLogo}
            alt="Marvel Card Vault"
            className="w-28 h-28 lg:w-36 lg:h-36 mx-auto mb-4"
          />

          <p className="text-red-400 text-sm font-semibold tracking-wider uppercase mb-1">
            {sharerName}'s Binder
          </p>
          <h1 className="text-2xl lg:text-3xl font-bebas text-white tracking-wider leading-tight mb-1">
            {fullDisplayName}
          </h1>
          {setInfo.year && (
            <p className="text-gray-500 text-xs">{setInfo.year}</p>
          )}

          <div className="flex items-center justify-center gap-3 mt-4">
            <div className="flex items-center gap-2">
              <span className="text-green-400 font-bold text-lg">{stats.ownedCount}</span>
              <span className="text-gray-500 text-sm">of</span>
              <span className="text-white font-bold text-lg">{stats.totalCards}</span>
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
        </div>
      </div>

      <div className="relative z-10 flex-1 max-w-lg mx-auto w-full px-4 py-4">
        {ownedCards.length === 0 ? (
          <div className="text-center py-12">
            <BookOpen className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400 text-lg">No cards collected yet</p>
            <p className="text-gray-600 text-sm mt-1">This binder is empty for now.</p>
          </div>
        ) : (
          <div
            className="relative rounded-2xl p-3"
            style={{
              background: 'linear-gradient(135deg, #1e1e2f 0%, #141422 50%, #0d0d1a 100%)',
              boxShadow: '0 0 40px rgba(220, 38, 38, 0.08), inset 0 2px 20px rgba(0,0,0,0.5), 0 10px 40px rgba(0,0,0,0.3)',
              border: '1px solid rgba(220, 38, 38, 0.15)',
            }}
          >
            <div
              className="absolute inset-0 rounded-2xl opacity-20 pointer-events-none"
              style={{
                background: 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255,255,255,0.02) 2px, rgba(255,255,255,0.02) 4px)'
              }}
            />

            <div className="flex lg:hidden items-center justify-between mb-2 relative z-10">
              {navButton("prev")}
              <span className="text-white/70 font-bold text-sm">
                {currentPage + 1} <span className="text-white/30">of</span> {totalPages}
              </span>
              {navButton("next")}
            </div>

            <div className="relative z-10">
              <div className="hidden lg:flex absolute left-3 top-1/2 -translate-y-1/2 z-20">
                {navButton("prev")}
              </div>

              <div style={{ perspective: '1000px' }}>
                <AnimatePresence mode="wait" custom={flipDirection}>
                  <motion.div
                    key={currentPage}
                    custom={flipDirection}
                    variants={pageVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
                    className="grid grid-cols-3 gap-2 mx-auto"
                    style={{ maxWidth: '400px' }}
                  >
                    {currentCards.map((card, index) => (
                      <SharedBinderSlot
                        key={`${currentPage}-${card.id}`}
                        card={card}
                        owned={true}
                        slotIndex={index}
                      />
                    ))}
                    {currentCards.length < cardsPerPage &&
                      [...Array(cardsPerPage - currentCards.length)].map((_, i) => (
                        <div
                          key={`empty-${i}`}
                          className="rounded-lg bg-gray-900/40 border border-gray-800/30"
                          style={{ aspectRatio: '2 / 3' }}
                        />
                      ))
                    }
                  </motion.div>
                </AnimatePresence>
              </div>

              <div className="hidden lg:flex absolute right-3 top-1/2 -translate-y-1/2 z-20">
                {navButton("next")}
              </div>
            </div>

            <div className="hidden lg:flex items-center justify-center gap-2 mt-3 relative z-10">
              <span className="text-white/70 font-bold text-sm">
                {currentPage + 1} <span className="text-white/30">of</span> {totalPages}
              </span>
            </div>

            <div className="mt-2 flex items-center justify-center gap-4 relative z-10">
              <div className="flex items-center gap-1">
                {[...Array(Math.min(totalPages, 10))].map((_, i) => {
                  const pageIndex = totalPages <= 10 ? i :
                    currentPage < 5 ? i :
                    currentPage > totalPages - 6 ? totalPages - 10 + i :
                    currentPage - 5 + i;

                  return (
                    <button
                      key={i}
                      onClick={() => {
                        setFlipDirection(pageIndex > currentPage ? "right" : "left");
                        setCurrentPage(pageIndex);
                      }}
                      className={`w-1.5 h-1.5 rounded-full transition-all duration-200
                        ${pageIndex === currentPage
                          ? 'bg-red-500 w-3'
                          : 'bg-white/20 hover:bg-white/40'
                        }
                      `}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 text-center">
          <p className="text-xs text-gray-500 mb-3 tracking-wider uppercase">Share this binder</p>
          <SocialShareButtons
            shareUrl={shareUrl}
            setName={displaySetName}
            sharerName={sharerName}
            mainSetName={setInfo.mainSetName}
          />
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
                Track your Marvel cards, build your binder, and share your collection with friends.
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
