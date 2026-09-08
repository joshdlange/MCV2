import { motion } from "framer-motion";
import { ArrowRight, Check } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface VaultRegularMomentProps {
  open: boolean;
  onComplete: () => void;
}

const confetti = [
  { left: "9%", top: "18%", delay: 0.05, rotate: "-18deg" },
  { left: "18%", top: "72%", delay: 0.2, rotate: "24deg" },
  { left: "78%", top: "15%", delay: 0.12, rotate: "18deg" },
  { left: "88%", top: "63%", delay: 0.28, rotate: "-28deg" },
  { left: "70%", top: "82%", delay: 0.38, rotate: "8deg" },
  { left: "28%", top: "9%", delay: 0.32, rotate: "-8deg" },
];

export function VaultRegularMoment({
  open,
  onComplete,
}: VaultRegularMomentProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onComplete();
      }}
    >
      <DialogContent
        className="overflow-hidden border-0 bg-transparent p-0 shadow-none sm:max-w-[430px]"
        aria-describedby="vault-regular-moment-description"
      >
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
          className="relative overflow-hidden rounded-[28px] border border-[#f3c9a6]/30 bg-[#17141b] text-[#fff9f1] shadow-[0_28px_90px_rgba(14,8,21,0.58)]"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-80"
            style={{
              background:
                "radial-gradient(circle at 50% 4%, rgba(237,111,76,.38), transparent 35%), radial-gradient(circle at 100% 40%, rgba(171,72,150,.28), transparent 38%), linear-gradient(145deg, #211727 0%, #17141b 62%)",
            }}
          />

          {confetti.map((piece) => (
            <motion.span
              key={`${piece.left}-${piece.top}`}
              aria-hidden="true"
              initial={{ opacity: 0, y: -5, scale: 0.6 }}
              animate={{ opacity: [0, 1, 0.65], y: [0, 8, 2], scale: 1 }}
              transition={{
                duration: 2.4,
                delay: piece.delay,
                repeat: Infinity,
                repeatType: "reverse",
                ease: "easeInOut",
              }}
              className="absolute z-10 h-2 w-1.5 rounded-full bg-[#f0b768]"
              style={{
                left: piece.left,
                top: piece.top,
                transform: `rotate(${piece.rotate})`,
              }}
            />
          ))}

          <div className="relative px-6 pb-6 pt-8 sm:px-9 sm:pb-8 sm:pt-10">
            <div className="mb-5 flex items-center justify-center gap-2">
              <span className="h-px w-8 bg-[#e49a67]/50" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#f0b768]">
                A new mark in your vault
              </span>
              <span className="h-px w-8 bg-[#e49a67]/50" />
            </div>

            <div className="relative mx-auto mb-7 flex h-[196px] w-[196px] items-center justify-center sm:h-[220px] sm:w-[220px]">
              <motion.div
                aria-hidden="true"
                animate={{ scale: [0.96, 1.04, 0.96], opacity: [0.38, 0.58, 0.38] }}
                transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
                className="absolute inset-2 rounded-full bg-[#dc724e]/30 blur-2xl"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.72, rotate: -8 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                transition={{ delay: 0.12, duration: 0.58, ease: [0.22, 1, 0.36, 1] }}
                className="relative h-full w-full overflow-hidden rounded-[31%] border-[5px] border-[#f6d39b]/90 bg-[#c65e58] shadow-[0_16px_36px_rgba(4,3,10,0.4)]"
              >
                <img
                  src="/uploads/badges/vault-regular.png"
                  alt="Vault Regular badge"
                  className="h-full w-full object-cover"
                />
              </motion.div>
            </div>

            <div className="text-center">
              <DialogTitle className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#f0b768]">
                Badge Unlocked
              </DialogTitle>
              <h2 className="mt-3 font-bebas text-[clamp(2.6rem,12vw,4.1rem)] leading-[0.9] tracking-[0.035em] text-[#fff9f1]">
                Vault Regular
              </h2>
              <DialogDescription
                id="vault-regular-moment-description"
                className="mx-auto mt-4 max-w-[260px] text-[15px] leading-6 text-[#d9cdd1]"
              >
                Came back to the vault 4 times on mobile.
              </DialogDescription>
            </div>

            <div className="mt-7 rounded-2xl border border-[#efc39d]/15 bg-[#fff9f1]/[0.06] px-4 py-3 text-center">
              <p className="text-xs leading-5 text-[#d9cdd1]">
                Your collection knows your way back.
              </p>
            </div>

            <Button
              type="button"
              onClick={onComplete}
              className="mt-5 h-12 w-full rounded-xl border border-[#ffdb9c]/40 bg-[#f0b768] text-[13px] font-bold uppercase tracking-[0.12em] text-[#2b1820] shadow-[0_8px_22px_rgba(240,183,104,0.2)] transition-transform hover:bg-[#f5c77e] hover:shadow-[0_10px_28px_rgba(240,183,104,0.3)] active:scale-[0.98]"
            >
              <Check className="h-4 w-4" strokeWidth={2.5} />
              Keep collecting
              <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
            </Button>
          </div>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}

export default VaultRegularMoment;