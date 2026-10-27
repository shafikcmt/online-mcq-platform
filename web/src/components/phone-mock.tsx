import { messages, type Lang } from "@/lib/i18n";

/** A phone showing the exam room — drawn with HTML/CSS (our own design, no image), purely
 * decorative: hidden from screen readers. */
export function PhoneMock({ lang }: { lang: Lang }) {
  const mock = messages(lang).home.mock;
  return (
    <div aria-hidden className="relative mx-auto w-64 select-none sm:w-72">
      <div className="absolute -inset-6 -z-10 rounded-[3rem] bg-gradient-to-br from-brand-400/30 via-brand-600/20 to-accent-500/20 blur-2xl" />
      <div className="rounded-[2.4rem] border-[10px] border-brand-950 bg-canvas p-3 shadow-float">
        <div className="mx-auto mb-3 h-1.5 w-16 rounded-full bg-brand-950/80" />
        <div className="flex items-center justify-between rounded-card bg-surface px-3 py-2 text-[11px] shadow-sm">
          <span className="font-semibold text-ink">{mock.exam}</span>
          <span className="rounded-full bg-brand-50 px-2 py-0.5 font-bold text-brand-700">{mock.time}</span>
        </div>
        <div className="mt-3 rounded-card bg-surface p-3 shadow-sm">
          <p className="text-[11px] font-semibold text-brand-700">{mock.question}</p>
          <p className="mt-1 text-sm font-medium text-ink">{mock.text}</p>
          <ul className="mt-3 flex flex-col gap-2">
            {mock.options.map((option, index) => (
              <li
                key={option}
                className={
                  index === 1
                    ? "flex items-center gap-2 rounded-control border-2 border-brand-600 bg-brand-50 px-2 py-1.5 text-xs font-semibold text-ink"
                    : "flex items-center gap-2 rounded-control border border-line-strong bg-surface px-2 py-1.5 text-xs text-ink"
                }
              >
                <span className={index === 1 ? "flex size-5 items-center justify-center rounded-full bg-brand-600 text-[10px] text-white" : "flex size-5 items-center justify-center rounded-full border border-line-strong text-[10px] text-ink-muted"}>
                  {index === 1 ? "✓" : "ABCD"[index]}
                </span>
                {option}
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-control border border-line-strong bg-surface py-2" />
          <div className="rounded-control bg-brand-600 py-2" />
        </div>
      </div>
    </div>
  );
}
