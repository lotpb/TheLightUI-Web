export interface AppNotification {
  id: string
  companyId: string
  type: string
  title: string
  body: string
  linkTo: string
  read: boolean
  createdAt: Date
}
