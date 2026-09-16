export interface Todo {
  id: string
  title: string
  notes: string
  isCompleted: boolean
  priority: 'low' | 'medium' | 'high'
  dueDate: Date | null
  createdAt: Date
  /**
   * When the task was checked off, or null.
   *
   * toggleTodo wrote only the boolean, so the Completed tab could show
   * nothing but "Added <date>" — the date it was created, never the date it
   * was finished, which is the only fact a completed list is for. Null on
   * tasks completed before this field existed.
   */
  completedAt: Date | null
  userId: string
  position: number
  customerId: string | null
  customerName: string | null
}
