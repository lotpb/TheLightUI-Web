import { z } from 'zod'
import type { ProposalLineItem } from '../models/proposal'

const proposalFormSchema = z.object({
  customerId: z.string(),
  customerName: z.string(),
  lineItems: z.array(z.object({
    description: z.string(),
    qty: z.number(),
    rate: z.number(),
  })).min(1),
}).superRefine((data, ctx) => {
  if (!data.customerId && !data.customerName.trim()) {
    ctx.addIssue({ code: 'custom', path: ['customerName'], message: 'Please select or enter a customer.' })
  }
  const hasValidLine = data.lineItems.some(l => l.description.trim() && l.qty > 0 && l.rate >= 0)
  if (!hasValidLine) {
    ctx.addIssue({ code: 'custom', path: ['lineItems'], message: 'Add at least one line item with a description and quantity.' })
  }
})

// Returns the first validation error message, or null if the form is valid.
export function validateProposalForm(input: {
  customerId: string
  customerName: string
  lineItems: ProposalLineItem[]
}): string | null {
  const result = proposalFormSchema.safeParse(input)
  if (result.success) return null
  return result.error.issues[0]?.message ?? 'Please check the form for errors.'
}
