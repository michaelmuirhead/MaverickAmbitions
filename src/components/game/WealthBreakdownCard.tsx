import { Card } from "@/components/ui/Card";
import { formatMoney } from "@/lib/money";
import type { WealthBreakdown } from "@/state/selectors";

interface WealthBreakdownCardProps {
  breakdown: WealthBreakdown;
  /** Count of player-owned businesses — shown as a hint next to "Business cash". */
  businessCount: number;
  /** Count of player-owned real-estate properties. */
  propertyCount: number;
}

/**
 * "Where your money is" — the breakdown behind the Net-worth headline.
 *
 * Players can see at a glance what's liquid (personal cash), what's trapped
 * inside each business (business cash sums across every store — can't be
 * freely spent elsewhere), what's illiquid but appreciating (real-estate
 * equity), and what's owed (mortgages + business loans). The total at the
 * bottom matches the Net-worth tile and the TopBar number.
 */
export function WealthBreakdownCard({
  breakdown,
  businessCount,
  propertyCount,
}: WealthBreakdownCardProps) {
  const {
    personalCash,
    businessCash,
    realEstateEquity,
    mortgageDebt,
    businessLoanDebt,
    totalDebt,
    grossAssets,
    netWorth,
  } = breakdown;

  return (
    <Card
      title="Where your money is"
      subtitle="Your net worth, broken out by what's liquid vs. trapped vs. illiquid."
    >
      <dl className="divide-y divide-ink-800 -mx-1">
        <Row
          label="Personal cash"
          hint="Freely spendable. Use this for real estate, loans, lifestyle."
          value={personalCash}
          tone="asset"
        />
        <Row
          label="Business cash"
          hint={
            businessCount === 0
              ? "You don't own any businesses yet."
              : `Pooled across ${businessCount} ${
                  businessCount === 1 ? "business" : "businesses"
                }. Trapped — can't spend outside the business until withdrawn.`
          }
          value={businessCash}
          tone="asset"
        />
        <Row
          label="Real estate equity"
          hint={
            propertyCount === 0
              ? "You don't own any property yet."
              : `${propertyCount} ${
                  propertyCount === 1 ? "property" : "properties"
                } — market value minus mortgage balance. Illiquid.`
          }
          value={realEstateEquity}
          tone="asset"
        />
        <Row
          label="Mortgage debt"
          hint="Outstanding principal on property mortgages."
          value={-mortgageDebt}
          tone="debt"
          hideIfZero
        />
        <Row
          label="Business loans"
          hint="Outstanding principal on business-loan debt."
          value={-businessLoanDebt}
          tone="debt"
          hideIfZero
        />
        <div className="flex items-baseline justify-between gap-3 py-3 px-1">
          <div className="text-xs uppercase tracking-wide text-ink-400">
            Gross assets − total debt
          </div>
          <div className="text-right font-mono text-xs tabular-nums text-ink-400">
            {formatMoney(grossAssets, { compact: true })}
            {totalDebt > 0
              ? ` − ${formatMoney(totalDebt, { compact: true })}`
              : ""}
          </div>
        </div>
        <div className="flex items-baseline justify-between gap-3 py-3 px-1 border-t border-ink-700">
          <div className="text-sm font-semibold text-ink-50">Net worth</div>
          <div
            className={`font-mono text-lg tabular-nums ${
              netWorth >= 0 ? "text-ink-50" : "text-loss"
            }`}
          >
            {formatMoney(netWorth, { sign: false })}
          </div>
        </div>
      </dl>
    </Card>
  );
}

interface RowProps {
  label: string;
  hint: string;
  value: number;
  tone: "asset" | "debt";
  hideIfZero?: boolean;
}

function Row({ label, hint, value, tone, hideIfZero }: RowProps) {
  if (hideIfZero && value === 0) return null;
  const valueClass =
    tone === "debt" ? "text-loss" : value > 0 ? "text-ink-50" : "text-ink-400";
  return (
    <div className="flex items-baseline justify-between gap-3 py-3 px-1">
      <div className="min-w-0">
        <div className="text-sm text-ink-200">{label}</div>
        <div className="text-xs text-ink-500 mt-0.5">{hint}</div>
      </div>
      <div className={`font-mono text-sm tabular-nums shrink-0 ${valueClass}`}>
        {formatMoney(value, { sign: value !== 0 && tone === "debt" })}
      </div>
    </div>
  );
}
