export type MedicationForm =
  | 'tablet'
  | 'capsule'
  | 'liquid'
  | 'injection'
  | 'topical'
  | 'inhaler'
  | 'drop'
  | 'other'

export type Recurrence = 'daily' | 'specific_days'

export type LogStatus = 'pending' | 'taken' | 'skipped' | 'missed'

export type NotificationChannel = 'push' | 'sms' | 'email'

export type NotificationStatus = 'sent' | 'failed' | 'mocked'

export interface Profile {
  id: string
  full_name: string | null
  timezone: string
  push_subscription: PushSubscriptionJSON | null
  created_at: string
  updated_at: string
}

export interface Medication {
  id: string
  user_id: string
  name: string
  dose_amount: number
  dose_unit: string
  form: MedicationForm
  instructions: string | null
  color_tag: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Schedule {
  id: string
  medication_id: string
  user_id: string
  time_of_day: string // 'HH:MM:SS'
  recurrence: Recurrence
  days_of_week: number[] | null
  start_date: string
  end_date: string | null
  is_active: boolean
  created_at: string
}

export interface MedicationLog {
  id: string
  medication_id: string
  schedule_id: string
  user_id: string
  scheduled_for: string // ISO8601
  status: LogStatus
  taken_at: string | null
  notified_at: string | null
  created_at: string
}

export interface NotificationLog {
  id: string
  user_id: string
  medication_log_id: string
  channel: NotificationChannel
  payload: Record<string, unknown>
  status: NotificationStatus
  sent_at: string
}

export interface MedicationExplanation {
  id: string
  query_key: string
  brand_name: string | null
  generic_name: string | null
  purpose: string | null
  warnings: string | null
  side_effects: string[]
  source: string
  fetched_at: string
  expires_at: string
}

// Edge Function response types
export interface ExplanationData {
  brand_name: string | null
  generic_name: string | null
  purpose: string | null
  warnings: string | null
  side_effects: string[]
  fetched_at: string
}

export interface ExplanationResponse {
  source: 'cache' | 'openfda' | 'fallback'
  data: ExplanationData
}

export interface PushSubscriptionJSON {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
}

// Form state types
export interface ScheduleFormEntry {
  timeOfDay: string
  recurrence: Recurrence
  daysOfWeek: number[]
}

export interface MedicationFormState {
  name: string
  doseAmount: string
  doseUnit: string
  form: MedicationForm
  instructions: string
  colorTag: string
  schedules: ScheduleFormEntry[]
}
