export interface Todo {
  id: string
  title: string
  notes: string
  isCompleted: boolean
  priority: 'low' | 'medium' | 'high'
  dueDate: Date | null
  createdAt: Date
  userId: string
  position: number
  customerId: string | null
  customerName: string | null
}
