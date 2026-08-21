import { z } from 'zod'

const expenseFormSchema = z.object({
  title: z.string().trim().min(1, 'Title is required.'),
  amount: z.number().refine(n => !isNaN(n) && n > 0, { message: 'Enter a valid amount.' }),
})

export type ExpenseFieldErrors = Partial<Record<'title' | 'amount', string>>

export function validateExpenseForm(input: { title: string; amount: number }): ExpenseFieldErrors {
  const result = expenseFormSchema.safeParse(input)
  if (result.success) return {}
  const errs: ExpenseFieldErrors = {}
  for (const issue of result.error.issues) {
    const key = issue.path[0] as keyof ExpenseFieldErrors
    if (!errs[key]) errs[key] = issue.message
  }
  return errs
}
