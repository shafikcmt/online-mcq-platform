import { isHttpsUrl } from "@/lib/account-helpers";
import type { PaymentMethod } from "@/lib/account";
import { cn } from "@/lib/cn";

type Props = {
  /** A unique prefix for the input ids (one picker per package). */
  id: string;
  methods: PaymentMethod[];
  legend: string;
  testBadge: string;
  testNote: string;
};

function Logo({ url }: { url: string }) {
  // The logo is an admin-entered https address: anything else is not drawn.
  if (!isHttpsUrl(url)) return null;
  // eslint-disable-next-line @next/next/no-img-element -- a small remote logo of unknown size
  return <img src={url} alt="" width={36} height={36} loading="lazy" className="size-9 shrink-0 rounded-control border border-line bg-white object-contain" />;
}

function Body({ method, testBadge }: { method: PaymentMethod; testBadge: string }) {
  return (
    <>
      <Logo url={method.logo_url} />
      <span className="flex min-w-0 flex-col">
        <span className="flex flex-wrap items-center gap-2 font-semibold text-ink">
          {method.name}
          {method.is_test ? <span className="rounded-full bg-warning-50 px-2 py-0.5 text-xs font-semibold text-warning-700">{testBadge}</span> : null}
        </span>
        {method.description ? <span className="text-sm text-ink-muted">{method.description}</span> : null}
      </span>
    </>
  );
}

/** "Pay with": the payment methods offered for one package. One method is shown as a plain
 * row (it is still sent, so the right merchant account is used); several are radio choices,
 * the first selected. The form field is `gateway`, the merchant account's identifier. */
export function MethodPicker({ id, methods, legend, testBadge, testNote }: Props) {
  if (methods.length === 0) return null;
  const hasTest = methods.some((method) => method.is_test);
  const row = "flex items-center gap-3 rounded-control border border-line bg-surface p-3";
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-ink">{legend}</legend>
      {methods.length === 1 ? (
        <div className={row}>
          <input type="hidden" name="gateway" value={methods[0].gateway} />
          <Body method={methods[0]} testBadge={testBadge} />
        </div>
      ) : (
        methods.map((method, index) => (
          <label key={method.gateway} htmlFor={`${id}-${method.gateway}`} className={cn(row, "cursor-pointer has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2")}>
            <input id={`${id}-${method.gateway}`} type="radio" name="gateway" value={method.gateway} defaultChecked={index === 0} className="size-4 shrink-0 accent-brand-600" />
            <Body method={method} testBadge={testBadge} />
          </label>
        ))
      )}
      {hasTest ? <p className="text-xs text-warning-700">{testNote}</p> : null}
    </fieldset>
  );
}
