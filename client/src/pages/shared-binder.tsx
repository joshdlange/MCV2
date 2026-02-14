import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Sparkles, BookOpen, Copy, Check } from "lucide-react";
import { SiFacebook, SiX, SiReddit, SiInstagram } from "react-icons/si";
import { Badge } from "@/components/ui/badge";
import { formatCardName, formatSetName } from "@/lib/formatTitle";
import heroLogoWhite from "@assets/noun-super-hero-380874-FFFFFF.png";

const PLACEHOLDER_IMAGE = 'https://res.cloudinary.com/dlwfuryyz/image/upload/v1748442577/card-placeholder_ysozlo.png';

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

function SharedBinderSlot({ card, owned, slotIndex }: { card: SharePageCard; owned: boolean; slotIndex: number }) {
  const imageUrl = card.frontImageUrl && card.frontImageUrl !== PLACEHOLDER_IMAGE ? card.frontImageUrl : null;
  const cardName = formatCardName(card.name);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: slotIndex * 0.03, duration: 0.2 }}
      className={`relative rounded-lg overflow-hidden w-full
        ${owned
          ? 'ring-2 ring-green-500/50 shadow-lg shadow-green-500/20'
          : 'ring-1 ring-gray-600/30 opacity-60'
        }
      `}
      style={{
        aspectRatio: '2 / 3',
        background: owned
          ? 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)'
          : 'linear-gradient(135deg, #2d2d2d 0%, #1a1a1a 100%)'
      }}
    >
      {owned && imageUrl ? (
        <div className="relative w-full h-full">
          <img
            src={imageUrl}
            alt={cardName}
            className="w-full h-full object-cover"
            loading="lazy"
          />
          {card.isInsert && (
            <div className="absolute bottom-1 left-1 bg-purple-600/90 text-white rounded-full w-5 h-5 flex items-center justify-center shadow-lg">
              <Sparkles className="w-3 h-3" />
            </div>
          )}
          <div className="absolute bottom-1 right-1 bg-green-600/90 text-white text-[8px] px-1 py-0.5 rounded font-bold shadow-lg">
            #{card.cardNumber}
          </div>
        </div>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center p-2 text-center">
          <div className="w-8 h-8 rounded-full bg-gray-700/50 flex items-center justify-center mb-1">
            <span className="text-gray-500 text-sm font-bold">?</span>
          </div>
          <span className="text-gray-400 text-[10px] font-medium leading-tight">
            #{card.cardNumber}
          </span>
          <span className="text-gray-500 text-[8px] mt-0.5 line-clamp-2 leading-tight px-1">
            {cardName}
          </span>
        </div>
      )}

      <div className="absolute inset-0 pointer-events-none rounded-lg"
        style={{
          boxShadow: 'inset 0 0 15px rgba(0,0,0,0.5), inset 0 2px 4px rgba(255,255,255,0.05)'
        }}
      />
    </motion.div>
  );
}

function SocialShareButtons({ shareUrl, setName, sharerName }: { shareUrl: string; setName: string; sharerName: string }) {
  const [copied, setCopied] = useState(false);
  const shareMessage = `Check out ${sharerName}'s ${setName} binder on Marvel Card Vault!`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  return (
    <div className="flex items-center justify-center gap-3">
      <button
        onClick={() => window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`, "_blank", "noopener,noreferrer,width=600,height=400")}
        className="w-9 h-9 rounded-full bg-[#1877F2] hover:bg-[#1565C0] text-white flex items-center justify-center transition-colors"
        title="Share on Facebook"
      >
        <SiFacebook className="w-4 h-4" />
      </button>
      <button
        onClick={() => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareMessage)}&url=${encodeURIComponent(shareUrl)}`, "_blank", "noopener,noreferrer,width=600,height=400")}
        className="w-9 h-9 rounded-full bg-black hover:bg-gray-800 text-white flex items-center justify-center transition-colors"
        title="Share on X"
      >
        <SiX className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => window.open(`https://www.reddit.com/submit?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(shareMessage)}`, "_blank", "noopener,noreferrer")}
        className="w-9 h-9 rounded-full bg-[#FF4500] hover:bg-[#E03D00] text-white flex items-center justify-center transition-colors"
        title="Share on Reddit"
      >
        <SiReddit className="w-4 h-4" />
      </button>
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(shareUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
            window.open("https://www.instagram.com/", "_blank", "noopener,noreferrer");
          } catch { /* ignore */ }
        }}
        className="w-9 h-9 rounded-full bg-gradient-to-br from-[#833AB4] via-[#FD1D1D] to-[#F77737] hover:opacity-90 text-white flex items-center justify-center transition-colors"
        title="Copy link & open Instagram"
      >
        <SiInstagram className="w-4 h-4" />
      </button>
      <button
        onClick={handleCopyLink}
        className="w-9 h-9 rounded-full bg-gray-600 hover:bg-gray-500 text-white flex items-center justify-center transition-colors"
        title="Copy link"
      >
        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
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
    queryKey: ['/api/share', token],
    enabled: !!token,
    retry: false,
  });

  const ownedSet = useMemo(() => {
    if (!data) return new Set<number>();
    return new Set(data.ownedCardIds);
  }, [data]);

  const sortedCards = useMemo(() => {
    if (!data) return [];
    return [...data.cards].sort((a, b) => {
      const numA = parseInt(a.cardNumber) || 0;
      const numB = parseInt(b.cardNumber) || 0;
      if (numA !== numB) return numA - numB;
      return a.cardNumber.localeCompare(b.cardNumber);
    });
  }, [data]);

  const totalPages = Math.ceil(sortedCards.length / cardsPerPage);
  const currentCards = sortedCards.slice(
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
      className="bg-white/20 text-white disabled:opacity-30 disabled:cursor-not-allowed h-10 w-10 rounded-full flex items-center justify-center border border-white/40 hover:bg-white/30 transition-colors"
    >
      {direction === "prev" ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
    </button>
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-10 h-10 border-4 border-red-600 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-500">Loading binder...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    const is410 = (error as any)?.message?.includes("revoked") || (error as any)?.status === 410;
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <header className="bg-gradient-to-r from-red-700 to-red-600 text-white px-6 py-4 shadow-lg">
          <div className="max-w-4xl mx-auto flex items-center gap-3">
            <img src={heroLogoWhite} alt="Marvel Card Vault" className="w-10 h-10" />
            <span className="font-bebas text-2xl tracking-wide">Marvel Card Vault</span>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center max-w-md">
            <BookOpen className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-gray-800 mb-2">
              {is410 ? "Link No Longer Active" : "Binder Not Found"}
            </h1>
            <p className="text-gray-500 mb-6">
              {is410
                ? "The owner has revoked this share link."
                : "This share link doesn't exist or may have been removed."}
            </p>
            <a
              href="/"
              className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-6 py-2.5 rounded-lg font-semibold transition-colors"
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
  const completionPct = stats.totalCards > 0
    ? Math.round((stats.ownedCount / stats.totalCards) * 100)
    : 0;
  const shareUrl = typeof window !== 'undefined' ? window.location.href : '';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-gradient-to-r from-red-700 to-red-600 text-white px-6 py-5 shadow-lg">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <img src={heroLogoWhite} alt="Marvel Card Vault" className="w-10 h-10" />
          <span className="font-bebas text-2xl tracking-wide">Marvel Card Vault</span>
        </div>
      </header>

      <div className="bg-white border-b border-gray-200 px-4 py-5">
        <div className="max-w-4xl mx-auto">
          <p className="text-sm text-red-600 font-semibold mb-1">{sharerName}'s Binder</p>
          <h1 className="text-2xl font-bebas text-gray-900 tracking-wide">{displaySetName}</h1>
          {setInfo.mainSetName && (
            <p className="text-sm text-gray-500">{setInfo.mainSetName} &middot; {setInfo.year}</p>
          )}
          <div className="flex items-center gap-3 mt-3">
            <Badge className="bg-green-100 text-green-700">
              {stats.ownedCount}/{stats.totalCards} owned
            </Badge>
            <div className="flex-1 max-w-xs bg-gray-200 rounded-full h-2.5">
              <div
                className="bg-green-500 h-2.5 rounded-full transition-all"
                style={{ width: `${completionPct}%` }}
              />
            </div>
            <span className="text-sm font-semibold text-gray-600">{completionPct}%</span>
          </div>
        </div>
      </div>

      <div className="flex-1 max-w-4xl mx-auto w-full px-4 py-6">
        <div className="w-full">
          <div
            className="relative rounded-2xl p-3"
            style={{
              background: 'linear-gradient(135deg, #1e1e2f 0%, #141422 50%, #0d0d1a 100%)',
              boxShadow: 'inset 0 2px 20px rgba(0,0,0,0.5), 0 10px 40px rgba(0,0,0,0.3)',
            }}
          >
            <div
              className="absolute inset-0 rounded-2xl opacity-30 pointer-events-none"
              style={{
                background: 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255,255,255,0.02) 2px, rgba(255,255,255,0.02) 4px)'
              }}
            />

            <div className="flex lg:hidden items-center justify-between mb-2 relative z-10">
              {navButton("prev")}
              <span className="text-white font-bold text-sm">
                {currentPage + 1} <span className="text-white/40">of</span> {totalPages}
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
                        owned={ownedSet.has(card.id)}
                        slotIndex={index}
                      />
                    ))}
                    {currentCards.length < cardsPerPage &&
                      [...Array(cardsPerPage - currentCards.length)].map((_, i) => (
                        <div
                          key={`empty-${i}`}
                          className="rounded-lg bg-gray-800/30 border border-gray-700/20"
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
              <span className="text-white font-bold text-sm">
                {currentPage + 1} <span className="text-white/40">of</span> {totalPages}
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
                          ? 'bg-white w-3'
                          : 'bg-white/30 hover:bg-white/50'
                        }
                      `}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 text-center">
          <p className="text-sm text-gray-500 mb-3">Share this binder</p>
          <SocialShareButtons shareUrl={shareUrl} setName={displaySetName} sharerName={sharerName} />
        </div>
      </div>

      <div className="bg-gradient-to-r from-red-700 to-red-600 px-4 py-8">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-white font-bebas text-3xl tracking-wide mb-2">Track Your Own Marvel Card Collection</h2>
          <p className="text-white/80 text-sm mb-5">
            Build your binder, track inserts, and manage your collection for free.
          </p>
          <a
            href="/"
            className="inline-flex items-center gap-2 bg-white text-red-700 hover:bg-gray-100 px-8 py-3 rounded-lg font-bold text-lg transition-colors shadow-lg"
          >
            Create Your Free Account
          </a>
          <p className="text-white/60 text-xs mt-4">
            Looking to buy? View cards on eBay directly from Marvel Card Vault.
          </p>
        </div>
      </div>
    </div>
  );
}
