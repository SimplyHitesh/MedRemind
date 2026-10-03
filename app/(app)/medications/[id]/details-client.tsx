'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Medication, Schedule } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

interface Props {
  medication: Medication
  schedules: Schedule[]
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function MedicationDetailsClient({ medication: initialMed, schedules }: Props) {
  const router = useRouter()
  const [med, setMed] = useState<Medication>(initialMed)
  const [refillOpen, setRefillOpen] = useState(false)
  const [refillAmount, setRefillAmount] = useState('30')
  const [refilling, setRefilling] = useState(false)

  const [extendOpen, setExtendOpen] = useState(false)
  const [extendDate, setExtendDate] = useState(med.duration_end_date ?? '')
  const [extending, setExtending] = useState(false)

  async function handleRefill() {
    if (!refillAmount || Number(refillAmount) <= 0) return
    setRefilling(true)
    try {
      const res = await fetch('/api/medications/refill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          medicationId: med.id,
          additionalTablets: Number(refillAmount),
        }),
      })
      const data = await res.json()
      if (res.ok && data.medication) {
        setMed((prev) => ({ ...prev, ...data.medication }))
        toast.success(`Added ${refillAmount} ${med.dose_unit} to supply!`)
        setRefillOpen(false)
        router.refresh()
      } else {
        toast.error(data.error || 'Failed to refill')
      }
    } catch {
      toast.error('Failed to refill supply')
    } finally {
      setRefilling(false)
    }
  }

  async function handleExtend() {
    setExtending(true)
    try {
      const res = await fetch('/api/medications/extend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          medicationId: med.id,
          newEndDate: extendDate || null,
        }),
      })
      const data = await res.json()
      if (res.ok && data.medication) {
        setMed((prev) => ({ ...prev, ...data.medication }))
        toast.success('Updated treatment end date!')
        setExtendOpen(false)
        router.refresh()
      } else {
        toast.error(data.error || 'Failed to extend treatment')
      }
    } catch {
      toast.error('Failed to extend treatment')
    } finally {
      setExtending(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-12">
      {/* Top Navigation */}
      <div className="flex items-center justify-between">
        <Link href="/dashboard">
          <Button variant="ghost" size="sm" className="text-xs text-gray-600">
            ← Back to Dashboard
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          <Link href={`/medications/${med.id}/explain`}>
            <Button size="sm" variant="outline" className="text-xs text-blue-700 border-blue-200 hover:bg-blue-50">
              💡 Explain Medicine
            </Button>
          </Link>
          <Link href={`/medications/${med.id}/edit`}>
            <Button size="sm" className="text-xs">
              ✏️ Edit
            </Button>
          </Link>
        </div>
      </div>

      {/* Main Header Card */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div
                className="w-5 h-5 rounded-full flex-shrink-0"
                style={{ backgroundColor: med.color_tag ?? '#3b82f6' }}
              />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{med.name}</h1>
                <p className="text-sm text-gray-500 mt-0.5">
                  {med.dose_amount} {med.dose_unit} · {med.form}
                </p>
              </div>
            </div>
            <Badge variant="outline" className={med.is_active ? 'border-green-300 text-green-700 bg-green-50' : 'border-gray-200 text-gray-500'}>
              {med.is_active ? 'Active' : 'Paused'}
            </Badge>
          </div>

          {med.instructions && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-lg text-sm text-blue-900">
              <span className="font-semibold">Instructions: </span>
              {med.instructions}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Supply & Refill Card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <span>📦</span> Supply & Inventory
            </CardTitle>
            <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => setRefillOpen(true)}>
              + Refill Supply
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
              <p className="text-xs text-gray-500">Remaining</p>
              <p className="text-lg font-bold text-gray-900 mt-0.5">
                {med.tablets_remaining != null ? `${med.tablets_remaining} ${med.dose_unit}` : 'Not tracked'}
              </p>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
              <p className="text-xs text-gray-500">Dose Size</p>
              <p className="text-lg font-bold text-gray-900 mt-0.5">
                {med.tablets_per_dose || 1} {med.dose_unit} / intake
              </p>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 col-span-2 sm:col-span-1">
              <p className="text-xs text-gray-500">Refill Warning</p>
              <p className="text-lg font-bold text-amber-700 mt-0.5">
                {med.refill_alert_days || 3} days before empty
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Treatment Duration Card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <span>🗓️</span> Treatment Duration
            </CardTitle>
            <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => setExtendOpen(true)}>
              Extend Treatment
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="bg-gray-50 p-3.5 rounded-lg border border-gray-100 flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500">Prescription End Date</p>
              <p className="text-base font-semibold text-gray-900 mt-0.5">
                {med.duration_end_date
                  ? new Date(med.duration_end_date).toLocaleDateString('en-US', {
                      weekday: 'short',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })
                  : 'Ongoing (No end date specified)'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Schedules Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <span>⏰</span> Reminder Schedules ({schedules.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-2">
          {schedules.length === 0 ? (
            <p className="text-sm text-gray-400 py-3">No active schedules for this medication.</p>
          ) : (
            schedules.map((s, idx) => {
              const [hours, minutes] = s.time_of_day.split(':').map(Number)
              const dateObj = new Date()
              dateObj.setHours(hours, minutes, 0, 0)
              const timeStr = dateObj.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
              })

              return (
                <div
                  key={s.id || idx}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-lg">⏰</span>
                    <div>
                      <p className="font-semibold text-sm text-gray-900">{timeStr}</p>
                      <p className="text-xs text-gray-500">
                        {s.recurrence === 'daily'
                          ? 'Every day'
                          : s.recurrence === 'specific_days' && s.days_of_week
                          ? s.days_of_week.map((d) => DAY_NAMES[d]).join(', ')
                          : 'As needed'}
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs border-blue-200 text-blue-700 bg-blue-50">
                    Dose #{idx + 1}
                  </Badge>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>

      {/* Refill Dialog */}
      <Dialog open={refillOpen} onOpenChange={setRefillOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>📦 Refill {med.name}</DialogTitle>
            <DialogDescription>
              Enter how many tablets/units you bought or received.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between text-sm text-gray-600 bg-gray-50 p-2.5 rounded-lg">
              <span>Current supply on hand:</span>
              <span className="font-semibold text-gray-900">
                {med.tablets_remaining ?? 0} {med.dose_unit}
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
            <Button variant="outline" onClick={() => setRefillOpen(false)} disabled={refilling}>
              Cancel
            </Button>
            <Button onClick={handleRefill} disabled={refilling || !refillAmount}>
              {refilling ? 'Updating…' : 'Confirm Refill'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Extend Dialog */}
      <Dialog open={extendOpen} onOpenChange={setExtendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>🗓️ Extend Treatment for {med.name}</DialogTitle>
            <DialogDescription>
              Doctor recommended taking this medication longer? Choose your new end date.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">New End Date</label>
              <Input
                type="date"
                min={new Date().toISOString().split('T')[0]}
                value={extendDate}
                onChange={(e) => setExtendDate(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtendOpen(false)} disabled={extending}>
              Cancel
            </Button>
            <Button onClick={handleExtend} disabled={extending || !extendDate}>
              {extending ? 'Updating…' : 'Save End Date'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
