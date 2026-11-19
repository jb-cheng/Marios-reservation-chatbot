import { ExperienceSection } from "@/components/site/ExperienceSection";
import { MenuSection } from "@/components/site/MenuSection";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";
import { StorySection } from "@/components/site/StorySection";
import { SECTIONS } from "@/components/site/sections";
import type { SectionId } from "@/components/site/sections";
import { RESTAURANT_FALLBACK_NAME } from "@/config";
import { useRestaurantConfig } from "@/hooks/use-restaurant-config";

export function MarketingPage({ page }: { page: Exclude<SectionId, "reservations"> }) {
  const { config } = useRestaurantConfig();
  const name = config?.name ?? RESTAURANT_FALLBACK_NAME;
  const title = SECTIONS.find((section) => section.id === page)!.label;

  return (
    <div className="grain relative flex min-h-screen flex-col bg-linen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-[3px] focus:bg-ink focus:px-4 focus:py-2 focus:text-[14px] focus:text-linen"
      >
        Skip to content
      </a>
      <SiteHeader name={name} active={page} />
      <main id="main-content" tabIndex={-1} className="flex-1 pt-[var(--nav-height)]">
        <h1 className="sr-only">{title}</h1>
        {page === "our-story" && <StorySection config={config} />}
        {page === "the-menu" && <MenuSection />}
        {page === "the-experience" && <ExperienceSection config={config} />}
      </main>
      <SiteFooter name={name} />
    </div>
  );
}
