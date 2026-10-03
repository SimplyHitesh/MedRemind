'use client'

import { useEffect, useOptimistic, useTransition, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { LogStatus, Medication } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'

interface MedicationInfo {
  id: string
  name: string
  dose_amount: number
  dose_unit: string
  form: string
  color_tag: string
  tablets_remaining: number | null
  tablets_per_dose: number
  refill_alert_days: number
  duration_end_date: string | null
}

interface LogWithMedication {
  id: string
  medication_id: string
  schedule_id: string
  user_id: string
  scheduled_for: string
  status: LogStatus
  taken_at: string | null
  notified_at: string | null
  snoozed_until: string | null
  medications: MedicationInfo | null
}

interface DashboardClientProps {
  initialLogs: LogWithMedication[]
  initialMedications: Medication[]
  userId: string
}

const STATUS_CONFIG: Record<LogStatus, { label: string; color: string; emoji: string }> = {
  pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-800 border-yellow-200', emoji: '⏳' },
  taken: { label: 'Taken', color: 'bg-green-100 text-green-800 border-green-200', emoji: '✅' },
  skipped: { label: 'Skipped', color: 'bg-gray-100 text-gray-600 border-gray-200', emoji: '⏭' },
  missed: { label: 'Missed', color: 'bg-red-100 text-red-800 border-red-200', emoji: '❌' },
}

type FilterType = 'all' | 'pending' | 'taken'

export default function DashboardClient({
  initialLogs,
  initialMedications,
  userId,
}: DashboardClientProps) {
  const [logs, setLogs] = useState<LogWithMedication[]>(initialLogs)
  const [medications, setMedications] = useState<Medication[]>(initialMedications)
  const [filter, setFilter] = useState<FilterType>('all')
  const [optimisticLogs, updateOptimisticLogs] = useOptimistic(
    logs,
    (state, { id, status }: { id: string; status: LogStatus }) =>
      state.map((log) => (log.id === id ? { ...log, status } : log))
  )
  const [isPending, startTransition] = useTransition()
  const [isMarking, setIsMarking] = useState<Record<string, boolean>>({})
  const [isSnoozing, setIsSnoozing] = useState<Record<string, boolean>>({})

  // Refill & Extend dialogs state
  const [refillMed, setRefillMed] = useState<Medication | null>(null)
  const [refillAmount, setRefillAmount] = useState('30')
  const [refilling, setRefilling] = useState(false)
  const [extendMed, setExtendMed] = useState<Medication | null>(null)
  const [extendDate, setExtendDate] = useState('')
  const [extending, setExtending] = useState(false)
  const [snoozeLog, setSnoozeLog] = useState<LogWithMedication | null>(null)
  const [snoozeMinutes, setSnoozeMinutes] = useState('10')

  // Realtime subscription
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('medication_logs_dashboard')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'medication_logs',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            supabase
              .from('medication_logs')
              .select(`*, medications(id, name, dose_amount, dose_unit, form, color_tag, tablets_remaining, tablets_per_dose, refill_alert_days, duration_end_date)`)
              .eq('id', (payload.new as { id: string }).id)
              .single()
              .then(({ data }) => {
                if (data) {
                  setLogs((prev) => {
                    const exists = prev.some((l) => l.id === data.id)
                    return exists
                      ? prev
                      : [...prev, data as LogWithMedication].sort(
                          (a, b) =>
                            new Date(a.scheduled_for).getTime() -
                            new Date(b.scheduled_for).getTime()
                        )
                  })
                }
              })
          } else if (payload.eventType === 'UPDATE') {
            setLogs((prev) =>
              prev.map((log) =>
                log.id === (payload.new as { id: string }).id
                  ? { ...log, ...(payload.new as Partial<LogWithMedication>) }
                  : log
              )
            )
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId])

  async function markAsTaken(logId: string) {
    setIsMarking((prev) => ({ ...prev, [logId]: true }))

    startTransition(() => {
      updateOptimisticLogs({ id: logId, status: 'taken' })
    })

    try {
      const res = await fetch('/api/logs/take', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logId }),
      })
      const data = await res.json()

      if (!res.ok || data.error) {
        startTransition(() => {
          updateOptimisticLogs({ id: logId, status: 'pending' })
        })
        toast.error(data.error || 'Failed to mark as taken.')
      } else {
        const remaining = data.log?.medications?.tablets_remaining
        if (remaining !== null && remaining !== undefined) {
          toast.success(`Marked as taken! ${remaining} left in supply.`)
          setMedications((prev) =>
            prev.map((m) =>
              m.id === data.log?.medication_id ? { ...m, tablets_remaining: remaining } : m
            )
          )
        } else {
          toast.success('Marked as taken!')
        }
      }
    } catch {
      startTransition(() => {
        updateOptimisticLogs({ id: logId, status: 'pending' })
      })
      toast.error('Failed to mark as taken.')
    } finally {
      setIsMarking((prev) => ({ ...prev, [logId]: false }))
    }
  }

  async function markAsSkipped(logId: string) {
    setIsMarking((prev) => ({ ...prev, [logId]: true }))
    const supabase = createClient()

    startTransition(() => {
      updateOptimisticLogs({ id: logId, status: 'skipped' })
    })

    const { error } = await supabase
      .from('medication_logs')
      .update({ status: 'skipped' })
      .eq('id', logId)

    if (error) {
      startTransition(() => {
        updateOptimisticLogs({ id: logId, status: 'pending' })
      })
      toast.error('Failed to skip dose.')
    } else {
      toast.info('Dose marked as skipped.')
    }
    setIsMarking((prev) => ({ ...prev, [logId]: false }))
  }

  async function confirmSnooze() {
    if (!snoozeLog) return
    const mins = Number(snoozeMinutes) || 10
    setIsSnoozing((prev) => ({ ...prev, [snoozeLog.id]: true }))
    try {
      const res = await fetch('/api/logs/snooze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logId: snoozeLog.id, minutes: mins }),
      })
      if (res.ok) {
        toast.info(`⏰ Snoozed for ${mins} minutes. We will remind you again!`)
        setSnoozeLog(null)
      } else {
        toast.error('Failed to snooze dose.')
      }
    } catch {
      toast.error('Failed to snooze dose.')
    } finally {
      setIsSnoozing((prev) => ({ ...prev, [snoozeLog.id]: false }))
    }
  }

  async function handleRefill() {
    if (!refillMed || !refillAmount || Number(refillAmount) <= 0) return
    setRefilling(true)
    try {
      const res = await fetch('/api/medications/refill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          medicationId: refillMed.id,
          additionalTablets: Number(refillAmount),
        }),
      })
      const data = await res.json()
      if (res.ok && data.medication) {
        setMedications((prev) =>
          prev.map((m) => (m.id === data.medication.id ? { ...m, ...data.medication } : m))
        )
        toast.success(`Added ${refillAmount} ${refillMed.dose_unit} to ${refillMed.name}`)
        setRefillMed(null)
      } else {
        toast.error(data.error || 'Failed to refill supply')
      }
    } catch {
      toast.error('Failed to refill supply')
    } finally {
      setRefilling(false)
    }
  }

  async function handleExtend() {
    if (!extendMed) return
    setExtending(true)
    try {
      const res = await fetch('/api/medications/extend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          medicationId: extendMed.id,
          newEndDate: extendDate || null,
        }),
      })
      const data = await res.json()
      if (res.ok && data.medication) {
        setMedications((prev) =>
          prev.map((m) => (m.id === data.medication.id ? { ...m, ...data.medication } : m))
        )
        toast.success(`Updated treatment end date for ${extendMed.name}`)
        setExtendMed(null)
      } else {
        toast.error(data.error || 'Failed to extend treatment')
      }
    } catch {
      toast.error('Failed to extend treatment')
    } finally {
      setExtending(false)
    }
  }

  const filtered = optimisticLogs.filter((log) => {
    if (filter === 'pending') return log.status === 'pending'
    if (filter === 'taken') return log.status === 'taken'
    return true
  })

  const pendingCount = optimisticLogs.filter((l) => l.status === 'pending').length
  const takenCount = optimisticLogs.filter((l) => l.status === 'taken').length

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  // Detect low supply medications
  const urgentRefillMeds = medications.filter((m) => {
    if (m.tablets_remaining === null) return false
    return Number(m.tablets_remaining) <= (m.tablets_per_dose || 1)
  })

  const warningRefillMeds = medications.filter((m) => {
    if (m.tablets_remaining === null) return false
    const rem = Number(m.tablets_remaining)
    const perDose = m.tablets_per_dose || 1
    const threshold = perDose * (m.refill_alert_days || 3)
    return rem > perDose && rem <= threshold
  })

  // Detect treatment nearing end
  const todayStr = new Date().toISOString().split('T')[0]
  const endingSoonMeds = medications.filter((m) => {
    if (!m.duration_end_date) return false
    const diffDays =
      (new Date(m.duration_end_date).getTime() - new Date(todayStr).getTime()) / 86400000
    return diffDays >= 0 && diffDays <= 3
  })

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Today&apos;s Doses</h1>
        <p className="text-gray-500 text-sm mt-1">{today}</p>
      </div>

      {/* Refill & Duration Alerts Banners */}
      <div className="space-y-3 mb-6">
        {urgentRefillMeds.map((med) => (
          <div
            key={med.id}
            className="flex items-center justify-between p-3.5 bg-red-50 border border-red-200 rounded-lg text-red-900"
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">🚨</span>
              <div>
                <p className="font-semibold text-sm">
                  CRITICAL: {med.name} supply is almost empty!
                </p>
                <p className="text-xs text-red-700">
                  Only <strong>{med.tablets_remaining} {med.dose_unit}</strong> remaining. You will run out today.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              className="bg-red-600 hover:bg-red-700 text-white text-xs"
              onClick={() => {
                setRefillMed(med)
                setRefillAmount('30')
              }}
            >
              + Refill Now
            </Button>
          </div>
        ))}

        {warningRefillMeds.map((med) => (
          <div
            key={med.id}
            className="flex items-center justify-between p-3.5 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-900"
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">⚠️</span>
              <div>
                <p className="font-semibold text-sm">
                  Refill Reminder: {med.name} running low
                </p>
                <p className="text-xs text-yellow-700">
                  {med.tablets_remaining} {med.dose_unit} left in stock. Time to order your refill.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="text-xs border-yellow-300 text-yellow-900 hover:bg-yellow-100"
              onClick={() => {
                setRefillMed(med)
                setRefillAmount('30')
              }}
            >
              + Refill
            </Button>
          </div>
        ))}

        {endingSoonMeds.map((med) => (
          <div
            key={med.id}
            className="flex items-center justify-between p-3.5 bg-indigo-50 border border-indigo-200 rounded-lg text-indigo-900"
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">🗓️</span>
              <div>
                <p className="font-semibold text-sm">
                  Treatment Ending Soon: {med.name}
                </p>
                <p className="text-xs text-indigo-700">
                  Prescription ends on {new Date(med.duration_end_date!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}. Need to extend?
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="text-xs border-indigo-300 text-indigo-900 hover:bg-indigo-100"
              onClick={() => {
                setExtendMed(med)
                setExtendDate(med.duration_end_date ?? '')
              }}
            >
              Extend Treatment
            </Button>
          </div>
        ))}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-6">
        <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 text-center shadow-sm">
          <p className="text-xl sm:text-2xl font-bold text-gray-900">{optimisticLogs.length}</p>
          <p className="text-[11px] sm:text-xs text-gray-500 mt-0.5">Total doses</p>
        </div>
        <div className="bg-green-50 rounded-lg border border-green-200 p-3 sm:p-4 text-center shadow-sm">
          <p className="text-xl sm:text-2xl font-bold text-green-700">{takenCount}</p>
          <p className="text-[11px] sm:text-xs text-green-600 mt-0.5">Taken</p>
        </div>
        <div className="bg-yellow-50 rounded-lg border border-yellow-200 p-3 sm:p-4 text-center shadow-sm">
          <p className="text-xl sm:text-2xl font-bold text-yellow-700">{pendingCount}</p>
          <p className="text-[11px] sm:text-xs text-yellow-600 mt-0.5">Pending</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4">
        {(['all', 'pending', 'taken'] as FilterType[]).map((f) => (
          <Button
            key={f}
            variant={filter === f ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter(f)}
            className="capitalize text-xs sm:text-sm px-3"
          >
            {f}
          </Button>
        ))}
      </div>

      {/* Log list */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400 bg-white rounded-lg border border-dashed border-gray-200 p-6">
          <p className="text-5xl mb-3">🎉</p>
          <p className="text-lg font-medium text-gray-800">
            {filter === 'pending' ? 'No pending doses!' : 'No doses scheduled yet'}
          </p>
          <p className="text-sm mt-1 text-gray-500">
            {optimisticLogs.length === 0
              ? 'Add medications and schedules to see your doses here'
              : 'All caught up for now'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((log) => {
            const med = log.medications
            const scheduledTime = new Date(log.scheduled_for).toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
            })
            const statusConfig = STATUS_CONFIG[log.status]
            const marking = isMarking[log.id]
            const snoozing = isSnoozing[log.id]

            return (
              <Card
                key={log.id}
                className={`transition-opacity ${log.status !== 'pending' ? 'opacity-70 bg-gray-50/50' : 'bg-white shadow-sm'}`}
              >
                <CardContent className="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  {/* Top / Left: Color indicator + Medication Name & Dosage details + Status badge */}
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div
                      className="w-3.5 h-3.5 rounded-full flex-shrink-0 mt-1"
                      style={{ backgroundColor: med?.color_tag ?? '#3b82f6' }}
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold text-base sm:text-sm text-gray-900 break-words leading-snug">
                          {med?.name ?? 'Unknown medication'}
                        </p>
                        <Badge
                          variant="outline"
                          className={`text-xs border ${statusConfig.color} flex-shrink-0 whitespace-nowrap ml-1`}
                        >
                          {statusConfig.emoji} {statusConfig.label}
                        </Badge>
                      </div>

                      <div className="text-xs sm:text-sm text-gray-500 mt-1 flex flex-wrap items-center gap-1.5 sm:gap-2">
                        <span className="font-medium text-gray-700">
                          {med?.dose_amount} {med?.dose_unit}
                        </span>
                        <span>·</span>
                        <span className="font-medium text-blue-700">⏰ {scheduledTime}</span>
                        {med?.tablets_remaining !== null && med?.tablets_remaining !== undefined && (
                          <span className="text-[11px] text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded font-medium ml-0.5">
                            📦 {med.tablets_remaining} left
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Bottom / Right Actions row on mobile, inline on desktop */}
                  {log.status === 'pending' && (
                    <div className="flex items-center gap-2 w-full sm:w-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-gray-100 flex-shrink-0">
                      <Button
                        size="sm"
                        onClick={() => markAsTaken(log.id)}
                        disabled={marking || snoozing || isPending}
                        className="flex-1 sm:flex-none bg-green-600 hover:bg-green-700 text-white font-medium text-xs sm:text-sm h-9 px-3.5 shadow-sm"
                      >
                        {marking ? '…' : '✅ Take'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSnoozeLog(log)
                          setSnoozeMinutes('10')
                        }}
                        disabled={marking || (snoozing && isSnoozing[log.id]) || isPending}
                        className="flex-1 sm:flex-none text-amber-700 border-amber-300 hover:bg-amber-50 font-medium text-xs sm:text-sm h-9 px-3"
                      >
                        {snoozing && isSnoozing[log.id] ? '…' : '⏰ Snooze'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => markAsSkipped(log.id)}
                        disabled={marking || snoozing || isPending}
                        className="text-gray-500 hover:text-gray-800 text-xs sm:text-sm h-9 px-2.5"
                      >
                        Skip
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Active Prescriptions / Medications Overview */}
      <div className="mt-10 border-t pt-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">💊 My Active Medications ({medications.length})</h2>
            <p className="text-xs text-gray-500">Overview of all prescribed medications and inventory status</p>
          </div>
          <Link href="/medications/add">
            <Button size="sm" variant="outline" className="text-xs border-blue-200 text-blue-700 hover:bg-blue-50">
              + Add Medication
            </Button>
          </Link>
        </div>

        {medications.length === 0 ? (
          <div className="bg-gray-50 border border-dashed border-gray-300 rounded-lg p-6 text-center">
            <p className="text-sm text-gray-500">No medications added yet.</p>
            <Link href="/medications/add" className="mt-2 inline-block">
              <Button size="sm" className="mt-2 text-xs">
                Add your first medication
              </Button>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {medications.map((m) => (
              <Card key={m.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-3.5 h-3.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: m.color_tag ?? '#3b82f6' }}
                    />
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-gray-900 truncate">{m.name}</p>
                      <p className="text-xs text-gray-500">
                        {m.dose_amount} {m.dose_unit} · {m.form}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        {m.tablets_remaining !== null && (
                          <span className="text-[11px] bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded font-medium">
                            📦 {m.tablets_remaining} in stock
                          </span>
                        )}
                        {m.duration_end_date && (
                          <span className="text-[11px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded font-medium">
                            🗓️ Until {m.duration_end_date}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 flex-shrink-0 ml-3">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-7 px-2.5 border-gray-300 text-gray-700 hover:bg-gray-50"
                      onClick={() => {
                        setRefillMed(m)
                        setRefillAmount('30')
                      }}
                    >
                      + Refill
                    </Button>
                    <Link href={`/medications/${m.id}`}>
                      <Button size="sm" variant="ghost" className="text-xs h-7 px-2.5 w-full text-blue-600 hover:text-blue-700">
                        Details →
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Refill Dialog */}
      <Dialog open={!!refillMed} onOpenChange={(open) => !open && setRefillMed(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>📦 Refill {refillMed?.name}</DialogTitle>
            <DialogDescription>
              Enter how many tablets/units you bought or received to update your current inventory.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between text-sm text-gray-600 bg-gray-50 p-2.5 rounded-lg">
              <span>Current supply on hand:</span>
              <span className="font-semibold text-gray-900">
                {refillMed?.tablets_remaining ?? 0} {refillMed?.dose_unit}
              </span>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Add Tablets / Units</label>
              <Input
                type="number"
                min="1"
                step="1"
                placeholder="e.g. 30"
                value={refillAmount}
                onChange={(e) => setRefillAmount(e.target.value)}
                autoFocus
              />
              <div className="flex gap-2 pt-1">
                {[10, 15, 30, 60, 90].map((preset) => (
                  <Button
                    key={preset}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs flex-1"
                    onClick={() => setRefillAmount(String(preset))}
                  >
                    +{preset}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefillMed(null)} disabled={refilling}>
              Cancel
            </Button>
            <Button
              onClick={handleRefill}
              disabled={refilling || !refillAmount || Number(refillAmount) <= 0}
            >
              {refilling ? 'Updating Supply…' : `Add +${refillAmount || 0} to Stock`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Extend Duration Dialog */}
      <Dialog open={!!extendMed} onOpenChange={(open) => !open && setExtendMed(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>📅 Extend Treatment Duration</DialogTitle>
            <DialogDescription>
              Adjust until when you need to take {extendMed?.name}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Take Until Date</label>
              <Input
                type="date"
                value={extendDate}
                onChange={(e) => setExtendDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
              />
              <p className="text-xs text-gray-500">
                {extendDate
                  ? `Active until ${new Date(extendDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                  : 'Ongoing treatment (no end date)'}
              </p>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-500">Quick Extension</p>
              <div className="flex gap-2 flex-wrap">
                {[5, 7, 14, 30].map((days) => (
                  <Button
                    key={days}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      const d = new Date()
                      d.setDate(d.getDate() + days)
                      setExtendDate(d.toISOString().split('T')[0])
                    }}
                  >
                    +{days} Days
                  </Button>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setExtendDate('')}
                >
                  Ongoing (No End Date)
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtendMed(null)} disabled={extending}>
              Cancel
            </Button>
            <Button onClick={handleExtend} disabled={extending}>
              {extending ? 'Saving…' : 'Save Duration'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Custom Snooze Dialog */}
      <Dialog open={!!snoozeLog} onOpenChange={(open) => !open && setSnoozeLog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>⏰ Snooze Reminder: {snoozeLog?.medications?.name}</DialogTitle>
            <DialogDescription>
              Choose how long you want to snooze this reminder. We will notify you again once the time is up.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Quick Snooze</label>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {[
                  { label: '5 min', val: '5' },
                  { label: '10 min', val: '10' },
                  { label: '15 min', val: '15' },
                  { label: '30 min', val: '30' },
                  { label: '1 hour', val: '60' },
                ].map((item) => (
                  <Button
                    key={item.val}
                    type="button"
                    variant={snoozeMinutes === item.val ? 'default' : 'outline'}
                    size="sm"
                    className="h-8 text-xs font-medium"
                    onClick={() => setSnoozeMinutes(item.val)}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Or Custom Minutes</label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="1"
                  max="1440"
                  step="1"
                  value={snoozeMinutes}
                  onChange={(e) => setSnoozeMinutes(e.target.value)}
                  placeholder="e.g. 20"
                  className="w-32"
                />
                <span className="text-sm text-gray-500">minutes later</span>
              </div>
            </div>

            <p className="text-xs text-amber-700 bg-amber-50 p-2.5 rounded-md border border-amber-200">
              💡 We will alert you again in <strong>{snoozeMinutes || 0} minutes</strong> so you won&apos;t miss your dose!
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSnoozeLog(null)} disabled={snoozeLog ? isSnoozing[snoozeLog.id] : false}>
              Cancel
            </Button>
            <Button
              onClick={confirmSnooze}
              disabled={!snoozeMinutes || Number(snoozeMinutes) <= 0 || (snoozeLog ? isSnoozing[snoozeLog.id] : false)}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {(snoozeLog && isSnoozing[snoozeLog.id]) ? 'Snoozing…' : `Snooze for ${snoozeMinutes || 0}m`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
