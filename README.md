Features

Core CRM
• Customer & Lead Management — Full CRUD for customers, leads, vendors, and employees; search, filter by category, salesperson, and callback status; paginated list with inline contact actions
• Lead Detail View — Rich profile with contact info, job dates, sale amount, address, ad source, salesperson assignment, follow-up date, callback toggle, and a timestamped notes timeline
• Customer Form — Comprehensive intake form with all CRM fields, category picker, and date selectors for start/completion dates
• Duplicate Detection — Scans the database for records with matching phone numbers or names and surfaces them for review and merge

Sales Pipeline & Jobs
• Pipeline (Kanban Board) — Drag-and-drop kanban view of leads across configurable stages; cards show name, phone, salesperson, and amount
• Jobs View — Tracks active jobs by status (started, in progress, completed) with date filtering and salesperson grouping
• Callback Queue — Prioritized list of leads marked for follow-up, sorted by follow-up date with one-tap call/SMS actions
• Targets — Set and track monthly revenue and deal-count targets per salesperson with progress indicators

Analytics & Reporting
• Dashboard — At-a-glance KPIs: total leads, active customers, revenue YTD, open callbacks, and recent activity feed
• Charts — Interactive bar, line, and pie charts for revenue by month, leads by source (adNo), conversion rate, and salesperson performance
• Reports — Exportable summary reports filtered by date range, category, and salesperson
• Lead Funnel Analytics — Visual funnel from raw leads → called → converted → job started → job completed, with call rate, conversion rate, and average deal size; monthly trend chart and breakdown by salesperson and ad source
• Revenue Forecast — Historical revenue area chart with linear-regression forward projection (+3/6/12 months); confidence band (±20%), deals-per-month bar chart, by-salesperson revenue table, and pipeline value from open leads

Communication & Outreach
• Chat (Messaging) — Real-time Firebase messaging between team members; inbox with unread badge, per-conversation log, and message timestamps
• Email/SMS Blast — Compose personalized bulk messages with merge tags ({first}, {city}, {salesman}); filter recipients by category, salesperson, callback status, and city; copy email list, open in Mail app, or generate SMS list; live preview of personalized message per recipient
• Follow-up Sequences — Define multi-step outreach templates (Call → SMS → Email with day offsets and instructions); assign sequences to customers; complete steps to auto-advance the follow-up date in Firestore; snooze, quick-note, and inline contact buttons; overdue/today/upcoming queue view

Scheduling & Calendar
• Appointment Calendar — Month, week, and list views of appointments derived from customer start/completion dates; rep-color-coded cards; click-through to customer records; rep filter legend; navigation controls
• Calendar (Events) — Personal/team calendar for scheduling meetings and reminders with native iOS EventKit integration

Financial
• Invoice Tracker — Create, edit, and send professional PDF-ready invoices with line items, tax rate, and due dates; status workflow (Draft → Sent → Paid / Overdue auto-detected); KPI cards for total billed, paid, outstanding, and overdue; email customer via mailto with pre-filled body
• Expenses — Log business expenses by category with receipt notes; list view with totals and date filtering
• Commission Tracking — Calculate and display commission earned per salesperson based on closed deals and configurable rates
• Quote Builder — Generate printable customer quotes with line items, tax, company branding, and PDF print support
• Goals — Set monthly revenue and activity goals with visual progress bars and historical comparison

Data & Operations
• CSV Import — 3-step wizard: upload CSV → map columns (auto-detection of 19 field aliases) → import with progress; download template; skips invalid rows with count
• Batch Actions — Select any subset of records using filters and checkboxes; bulk assign salesperson, change category, set follow-up date, set callback status, export as CSV, deactivate, or delete — all via Firestore writeBatch
• Geographic Distribution (Heat Map) — Groups customers by state and city; color-intensity heat tiles (cool → warm by concentration); drill down from state → city view; sortable data table with revenue, conversion rate, and concentration bars; top-15 bar chart
• Activity Feed — Chronological log of all record changes, notes added, and status updates across the company

Mapping & Location
• Maps — Full Google Maps integration with turn-by-turn directions, geofence zones with entry/exit alerts, saved favorites, route summary with distance/ETA, and address search

Productivity
• To-Do — Personal task list with due dates, priority flags, and edit/delete; persists per user
• Duplicate Finder — Identifies and surfaces potential duplicate customer records for cleanup
• Global Search — Cmd+K keyboard shortcut opens a full-app search across all customer records, navigating directly to any result
• Reminders / Notifications — Browser push notification reminders tied to follow-up dates with urgency badge on the bell icon

Settings & Administration
• Profile — Edit display name, email, and profile photo stored in Firebase Auth
• Settings — Configure company name, address, phone, email (used in invoices and quotes); manage app preferences
• Authentication — Email/password login and registration scoped to a company ID; session persistence via Firebase Auth
