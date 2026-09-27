'use client'

import { useEffect, useOptimistic, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { LogStatus } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { toast } from 'sonner'
import { useState } from 'react'

interface MedicationInfo {
  id: string
  name: string
  dose_amount: number
  dose_unit: string
  form: string
  color_tag: string
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
  medications: MedicationInfo | null
}

interface DashboardClientProps {
  initialLogs: LogWithMedication[]
  userId: string
}

const STATUS_CONFIG: Record<LogStatus, { label: string; color: string; emoji: string }> = {
  pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-800 border-yellow-200', emoji: '⏳' },
  taken: { label: 'Taken', color: 'bg-green-100 text-green-800 border-green-200', emoji: '✅' },
  skipped: { label: 'Skipped', color: 'bg-gray-100 text-gray-600 border-gray-200', emoji: '⏭' },
  missed: { label: 'Missed', color: 'bg-red-100 text-red-800 border-red-200', emoji: '❌' },
}

type FilterType = 'all' | 'pending' | 'taken'

export default function DashboardClient({ initialLogs, userId }: DashboardClientProps) {
  const [logs, setLogs] = useState<LogWithMedication[]>(initialLogs)
  const [filter, setFilter] = useState<FilterType>('all')
  const [optimisticLogs, updateOptimisticLogs] = useOptimistic(
    logs,
    (state, { id, status }: { id: string; status: LogStatus }) =>
      state.map((log) => (log.id === id ? { ...log, status } : log))
  )
  const [isPending, startTransition] = useTransition()
  const [isMarking, setIsMarking] = useState<Record<string, boolean>>({})

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
            // Fetch the full row with medication join
            supabase
              .from('medication_logs')
              .select(`*, medications(id, name, dose_amount, dose_unit, form, color_tag)`)
              .eq('id', (payload.new as { id: string }).id)
              .single()
              .then(({ data }) => {
                if (data) {
                  setLogs((prev) => {
                    const exists = prev.some((l) => l.id === data.id)
                    return exists ? prev : [...prev, data as LogWithMedication].sort(
                      (a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime()
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
    const supabase = createClient()

    startTransition(() => {
      updateOptimisticLogs({ id: logId, status: 'taken' })
    })

    const { error } = await supabase
      .from('medication_logs')
      .update({ status: 'taken', taken_at: new Date().toISOString() })
      .eq('id', logId)

    if (error) {
      // Rollback optimistic update
      startTransition(() => {
        updateOptimisticLogs({ id: logId, status: 'pending' })
      })
      toast.error('Failed to mark as taken. Please try again.')
    } else {
      toast.success('Marked as taken!')
    }
    setIsMarking((prev) => ({ ...prev, [logId]: false }))
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
    }
    setIsMarking((prev) => ({ ...prev, [logId]: false }))
  }

  const filtered = optimisticLogs.filter((log) => {
    if (filter === 'pending') return log.status === 'pending'
    if (filter === 'taken') return log.status === 'taken'
    return true
  })

  const pendingCount = optimisticLogs.filter((l) => l.status === 'pending').length
  const takenCount = optimisticLogs.filter((l) => l.status === 'taken').length

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Today&apos;s Doses</h1>
        <p className="text-gray-500 text-sm mt-1">{today}</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{optimisticLogs.length}</p>
          <p className="text-xs text-gray-500 mt-1">Total doses</p>
        </div>
        <div className="bg-green-50 rounded-lg border border-green-200 p-4 text-center">
          <p className="text-2xl font-bold text-green-700">{takenCount}</p>
          <p className="text-xs text-green-600 mt-1">Taken</p>
        </div>
        <div className="bg-yellow-50 rounded-lg border border-yellow-200 p-4 text-center">
          <p className="text-2xl font-bold text-yellow-700">{pendingCount}</p>
          <p className="text-xs text-yellow-600 mt-1">Pending</p>
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
            className="capitalize"
          >
            {f}
          </Button>
        ))}
      </div>

      {/* Log list */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-5xl mb-3">🎉</p>
          <p className="text-lg font-medium">
            {filter === 'pending' ? 'No pending doses!' : 'No doses scheduled yet'}
          </p>
          <p className="text-sm mt-1">
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
              hour: '2-digit', minute: '2-digit',
            })
            const statusConfig = STATUS_CONFIG[log.status]
            const marking = isMarking[log.id]

            return (
              <Card key={log.id} className={`transition-opacity ${log.status !== 'pending' ? 'opacity-70' : ''}`}>
                <CardContent className="flex items-center gap-4 py-4">
                  {/* Color dot */}
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: med?.color_tag ?? '#3b82f6' }}
                  />

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">
                      {med?.name ?? 'Unknown medication'}
                    </p>
                    <p className="text-sm text-gray-500">
                      {med?.dose_amount} {med?.dose_unit} · {scheduledTime}
                    </p>
                  </div>

                  {/* Status badge */}
                  <Badge
                    variant="outline"
                    className={`text-xs border ${statusConfig.color}`}
                  >
                    {statusConfig.emoji} {statusConfig.label}
                  </Badge>

                  {/* Actions */}
                  {log.status === 'pending' && (
                    <div className="flex gap-2 flex-shrink-0">
                      <Button
                        size="sm"
                        onClick={() => markAsTaken(log.id)}
                        disabled={marking || isPending}
                        className="bg-green-600 hover:bg-green-700 text-white"
                      >
                        {marking ? '…' : 'Take'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => markAsSkipped(log.id)}
                        disabled={marking || isPending}
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
    </div>
  )
}
