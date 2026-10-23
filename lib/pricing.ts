/**
 * Seen Pro prices — ONE place, so Settings, modals and copy never disagree with /pricing.
 * app/pricing/page.tsx and components/UpgradeModal.tsx still carry their own local copies of
 * these numbers (owned by another change); `lib/pricing.test.mjs` pins them to this file so a
 * drift fails the suite instead of shipping two prices.
 */
export const PRO_MONTHLY = 9.99
/** Per-month price of the yearly plan ("$6.99/mo billed yearly"). */
export const PRO_YEARLY_PER_MONTH = 6.99
export const PRO_YEARLY_TOTAL = +(PRO_YEARLY_PER_MONTH * 12).toFixed(2) // 83.88

export const usd = (n: number) => `$${n.toFixed(2)}`

/** "$9.99/month, or $83.88/year ($6.99/mo)" — the same three numbers /pricing shows. */
export function proPriceLine(): string {
  return `${usd(PRO_MONTHLY)}/month, or ${usd(PRO_YEARLY_TOTAL)}/year (${usd(PRO_YEARLY_PER_MONTH)}/mo)`
}
