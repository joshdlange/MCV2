import { useEffect,useState } from "react";
import { UpgradeModal } from "./upgrade-modal";
export function MarketUpgradeHost() {
  const [open,setOpen]=useState(false);
  useEffect(()=>{
    const show=()=>setOpen(true);
    window.addEventListener("market-upgrade-required",show);
    return ()=>window.removeEventListener("market-upgrade-required",show);
  },[]);
  return <UpgradeModal isOpen={open} onClose={()=>setOpen(false)} currentPlan="SIDE_KICK"
    trigger="market-price" title="Unlock unlimited Market Price refreshes with SUPER_HERO."
    description="Get the latest available card values whenever you need them." />;
}
