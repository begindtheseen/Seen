/**
 * Seen Pro prices — ONE place. The numbers live in lib/server/creditRules.js (PRO_PRICING, pinned to
 * api/stripe.js by its test); this module just gives the client typed names and the Settings line.
 */
import { PRO_PRICING } from './server/creditRules.js'

export const PRO_MONTHLY: number = PRO_PRICING.monthly
/** Per-month price of the yearly plan ("$6.99/mo billed yearly"). */
export const PRO_YEARLY_PER_MONTH: number = PRO_PRICING.yearly_per_month
export const PRO_YEARLY_TOTAL: number = PRO_PRICING.yearly_total

export const usd = (n: number) => `$${n.toFixed(2)}`

/** "$9.99/month, or $83.88/year ($6.99/mo)" — the same three numbers /pricing shows. */
export function proPriceLine(): string {
  return `${usd(PRO_MONTHLY)}/month, or ${usd(PRO_YEARLY_TOTAL)}/year (${usd(PRO_YEARLY_PER_MONTH)}/mo)`
}
