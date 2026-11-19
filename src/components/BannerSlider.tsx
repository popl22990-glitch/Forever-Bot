import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ArrowRight } from 'lucide-react';
import type { NavSection } from '../types';

interface BannerSlide {
  id: string;
  title: string;
  burmeseLabel: string;
  subtitle: string;
  image: string;
  ctaLabel: string;
  targetNav: NavSection;
}

const SLIDES: BannerSlide[] = [
  {
    id: 'forever-bot',
    title: 'FOREVER BOT',
    burmeseLabel: 'Viber နှင့် Telegram ဝန်ဆောင်မှုစနစ်',
    subtitle: 'သင့် Customer များကို တစ်နေရာတည်းမှ အလွယ်တကူ စီမံခန့်ခွဲလိုက်ပါ',
    image: '/src/assets/images/banner_forever_bot_1795077343018.jpg',
    ctaLabel: 'Bot များ စီမံရန်',
    targetNav: 'bots',
  },
  {
    id: 'smart-inbox',
    title: 'SMART CUSTOMER INBOX',
    burmeseLabel: 'တစ်နေရာတည်း စုစည်းထားသော Inbox',
    subtitle: 'Viber နှင့် Telegram စာများကို တစ်နေရာတည်းတွင် လက်ခံဖြေကြားနိုင်ပါပြီ',
    image: '/src/assets/images/banner_smart_inbox_1795077343406.jpg',
    ctaLabel: 'Inbox ဖွင့်ရန်',
    targetNav: 'inbox',
  },
  {
    id: 'powerful-broadcast',
    title: 'POWERFUL BROADCAST',
    burmeseLabel: 'မြန်ဆန်ထိရောက်သော Broadcast စနစ်',
    subtitle: 'သင့် Customer များထံ သတင်းအချက်အလက်များကို လွယ်ကူမြန်ဆန်စွာ ပို့ဆောင်လိုက်ပါ',
    image: '/src/assets/images/banner_powerful_broadcast_1795077343579.jpg',
    ctaLabel: 'Broadcast ပို့ရန်',
    targetNav: 'broadcast',
  },
];

interface BannerSliderProps {
  onNavigate: (section: NavSection) => void;
}

export const BannerSlider: React.FC<BannerSliderProps> = ({ onNavigate }) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % SLIDES.length);
    }, 6000);
    return () => clearInterval(timer);
  }, [paused]);

  const goPrev = () => setActiveIndex((prev) => (prev - 1 + SLIDES.length) % SLIDES.length);
  const goNext = () => setActiveIndex((prev) => (prev + 1) % SLIDES.length);

  return (
    <section
      aria-label="Promotional Highlights"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="relative w-full overflow-hidden rounded-2xl border border-[#D4AF37]/35 bg-[#140A0D]"
    >
      <div className="relative h-[260px] sm:h-[290px] lg:h-[320px] w-full">
        {SLIDES.map((slide, idx) => {
          const isActive = idx === activeIndex;
          const hasError = imgErrors[slide.id];

          return (
            <div
              key={slide.id}
              aria-hidden={!isActive}
              className={`absolute inset-0 transition-opacity duration-500 ${
                isActive ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'
              }`}
            >
              {/* Background Image (must be absolute inset-0 so text layer overlays cleanly) */}
              {!hasError ? (
                <img
                  src={slide.image}
                  alt={slide.title}
                  referrerPolicy="no-referrer"
                  onError={() =>
                    setImgErrors((prev) => ({ ...prev, [slide.id]: true }))
                  }
                  className="absolute inset-0 h-full w-full object-cover object-center"
                />
              ) : (
                <div className="absolute inset-0 h-full w-full bg-gradient-to-br from-[#450A0A] via-[#7F1D1D] to-[#1A0D08]" />
              )}

              {/* Red & Gold contrast scrim so Burmese & English typography always remains crisp and legible */}
              <div
                className="absolute inset-0"
                style={{
                  background:
                    'linear-gradient(100deg, rgba(16, 4, 7, 0.94) 0%, rgba(127, 29, 29, 0.78) 52%, rgba(212, 175, 55, 0.24) 100%)',
                }}
              />

              {/* Foreground Burmese + English Slide Text */}
              <div className="relative z-10 flex h-full flex-col justify-center px-6 pt-5 pb-14 sm:px-10 lg:px-14 max-w-3xl">
                <p className="text-xs font-medium text-[#FDE68A] mb-1.5 tabular-nums">
                  0{idx + 1} / 0{SLIDES.length} · {slide.burmeseLabel}
                </p>
                <h2 className="font-display text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight bg-gradient-to-r from-[#FFFDF7] via-[#FDE68A] to-[#D4AF37] bg-clip-text text-transparent">
                  {slide.title}
                </h2>
                <p className="mt-2.5 text-sm sm:text-base lg:text-lg leading-relaxed text-[#FAF7F2] font-medium drop-shadow-sm">
                  {slide.subtitle}
                </p>
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => onNavigate(slide.targetNav)}
                    className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#991B1B] via-[#B91C1C] to-[#D97706] px-4 py-2 text-xs sm:text-sm font-semibold text-white hover:brightness-110 transition whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#FDE68A]"
                  >
                    <span>{slide.ctaLabel}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Previous / Next Controls */}
      <div className="absolute right-4 bottom-4 z-20 flex items-center gap-2">
        <button
          type="button"
          onClick={goPrev}
          aria-label="Previous slide"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#D4AF37]/40 bg-[#12070A]/85 text-[#FDE68A] hover:bg-[#7F1D1D]/80 transition cursor-pointer focus-visible:outline-2 focus-visible:outline-[#FDE68A]"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={goNext}
          aria-label="Next slide"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#D4AF37]/40 bg-[#12070A]/85 text-[#FDE68A] hover:bg-[#7F1D1D]/80 transition cursor-pointer focus-visible:outline-2 focus-visible:outline-[#FDE68A]"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Slide Indicators */}
      <div className="absolute left-6 sm:left-10 lg:left-14 bottom-4 z-20 flex items-center gap-2">
        {SLIDES.map((slide, idx) => {
          const active = idx === activeIndex;
          return (
            <button
              key={slide.id}
              type="button"
              onClick={() => setActiveIndex(idx)}
              aria-label={`Go to slide ${idx + 1}: ${slide.title}`}
              className={`h-1.5 rounded-full transition-all cursor-pointer ${
                active
                  ? 'w-8 bg-gradient-to-r from-[#DC2626] to-[#F59E0B]'
                  : 'w-3 bg-white/35 hover:bg-white/60'
              }`}
            />
          );
        })}
      </div>
    </section>
  );
};
