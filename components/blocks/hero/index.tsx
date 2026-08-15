import HeroBg from "./bg";
import { Hero as HeroType } from "@/types/blocks/hero";
import { FlightSearch } from "./flight-search";
import { CalendarCheck2 } from "lucide-react";

export default function Hero({ hero }: { hero: HeroType }) {
  if (hero.disabled) {
    return null;
  }

  return (
    <>
      <HeroBg />
      <section className="relative pt-16 pb-12 bg-gradient-to-b from-sky-50/30 via-white to-blue-50/20">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50/30 via-transparent to-sky-50/20 pointer-events-none" />
        <div className="container relative">
          <div id="flight-search-section" className="flex items-center justify-center gap-3 mb-6">
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900">
              海航
              <span
                className="inline-block bg-gradient-to-r from-sky-500 via-blue-500 to-sky-400 bg-clip-text text-transparent"
              >
                随心飞
              </span>
              <span className="text-gray-900"> · 航线搜索</span>
            </h1>
          </div>

          <p className="mb-3 text-center text-lg text-gray-600 sm:text-xl">
            专为海航随心飞用户打造的智能航线规划工具
          </p>

          {hero.updateNotice && (
            <div
              role="status"
              className="mx-auto mb-6 flex w-fit max-w-[calc(100vw-2rem)] flex-col items-center gap-1 rounded-xl border border-sky-100/90 bg-white/80 px-3.5 py-2 text-center shadow-[0_10px_30px_-22px_rgba(14,116,144,0.65)] backdrop-blur-sm sm:flex-row sm:gap-2.5 sm:rounded-full sm:px-4 sm:text-left"
            >
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-semibold text-slate-800">
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-600">
                  <CalendarCheck2 className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                {hero.updateNotice.title}
              </span>
              <span aria-hidden="true" className="hidden h-3.5 w-px bg-slate-200 sm:block" />
              <span className="text-[11px] leading-4 text-slate-500 sm:whitespace-nowrap sm:text-xs">
                {hero.updateNotice.description}
              </span>
            </div>
          )}

          <div>
            <FlightSearch />
          </div>
        </div>
      </section>
    </>
  );
}
