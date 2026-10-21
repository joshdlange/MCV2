import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Route, Switch } from "wouter";
import { queryClient } from "../../client/src/lib/queryClient";
import { useAppStore } from "../../client/src/lib/store";
import { CardValue } from "../../client/src/components/cards/card-value";
import { CardDetailModal } from "../../client/src/components/cards/card-detail-modal";
import type { CardWithSet } from "../../shared/schema";
import { MarketUpgradeHost } from "../../client/src/components/subscription/market-upgrade-host";
import { NotificationBell } from "../../client/src/components/NotificationBell";
import { XpPowerMeter } from "../../client/src/components/dashboard/xp-power-meter";
import Social from "../../client/src/pages/Social";
import { TooltipProvider } from "../../client/src/components/ui/tooltip";
import { Toaster } from "../../client/src/components/ui/toaster";

const account = await fetch("/api/test-account").then(r => r.json());
useAppStore.setState({ currentUser: account });
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}><TooltipProvider>
    <main className="p-4 max-w-4xl mx-auto">
      <header className="flex justify-between mb-6"><h1>Market Price browser verification</h1><NotificationBell /></header>
      <Switch>
        <Route path="/social" component={Social} />
        <Route path="/detail/:id">{params => <CardDetailModal
          card={{ id: Number(params.id), name: "Knull", cardNumber: "FF-23", rarity: "Common",
            set: { name: "Fanfare" } } as CardWithSet}
          isOpen onClose={() => { window.location.href = "/"; }}
        />}</Route>
        <Route>
          <div className="bg-gray-950 p-4 rounded mb-6"><XpPowerMeter /></div>
          {[1, 2].map(id => <section key={id} data-testid={`card-${id}`} className="bg-white p-6 mb-4">
            <h2 className="text-black">Market Price — card {id}</h2><CardValue cardId={id} showRefresh />
          </section>)}
        </Route>
      </Switch>
    </main><MarketUpgradeHost /><Toaster />
  </TooltipProvider></QueryClientProvider>,
);
