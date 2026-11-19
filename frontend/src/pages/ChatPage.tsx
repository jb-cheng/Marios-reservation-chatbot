import { ChatPanel } from "@/components/ChatPanel";
import { HeroBand } from "@/components/site/HeroBand";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";
import { RESTAURANT_FALLBACK_NAME } from "@/config";
import { useRestaurantConfig } from "@/hooks/use-restaurant-config";

export function ChatPage() {
  const { config } = useRestaurantConfig();
  const name = config?.name ?? RESTAURANT_FALLBACK_NAME;
  return (
    <div className="reservation-page grain relative min-h-dvh bg-linen">
      <a href="#reservations" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-[3px] focus:bg-ink focus:px-4 focus:py-2 focus:text-linen">Skip to reservations</a>
      <SiteHeader name={name} />
      <main id="reservations" className="reservation-main">
        <div className="reservation-hero"><HeroBand config={config} /></div>
        <ChatPanel />
      </main>
      <SiteFooter name={name} compact />
    </div>
  );
}
