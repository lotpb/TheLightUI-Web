import { z } from 'zod'

const optionalEmail = z.string().trim().refine(
  v => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  { message: 'Enter a valid email address.' },
)

const customerFormSchema = z.object({
  category: z.string(),
  first: z.string(),
  lastname: z.string(),
  email: optionalEmail,
}).superRefine((data, ctx) => {
  const isVendor = data.category.toLowerCase() === 'vendor'
  if (!data.first.trim()) {
    ctx.addIssue({ code: 'custom', path: ['first'], message: isVendor ? 'Vendor name is required.' : 'First name is required.' })
  }
  if (!isVendor && !data.lastname.trim()) {
    ctx.addIssue({ code: 'custom', path: ['lastname'], message: 'Last name is required.' })
  }
})

export type CustomerFieldErrors = Partial<Record<'first' | 'lastname' | 'email', string>>

export function validateCustomerForm(input: {
  category: string
  first: string
  lastname: string
  email: string
}): CustomerFieldErrors {
  const result = customerFormSchema.safeParse(input)
  if (result.success) return {}
  const errs: CustomerFieldErrors = {}
  for (const issue of result.error.issues) {
    const key = issue.path[0] as keyof CustomerFieldErrors
    if (!errs[key]) errs[key] = issue.message
  }
  return errs
}
