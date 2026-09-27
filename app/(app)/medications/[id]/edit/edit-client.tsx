'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Medication, Schedule, MedicationForm, Recurrence, ScheduleFormEntry } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { MedicationAutocomplete } from '@/components/medication-autocomplete'
import { toast } from 'sonner'

const FORM_OPTIONS: MedicationForm[] = [
  'tablet', 'capsule', 'liquid', 'injection', 'topical', 'inhaler', 'drop', 'other',
]
const DOSE_UNITS = ['mg', 'ml', 'mcg', 'g', 'tablet(s)', 'capsule(s)', 'drop(s)', 'unit(s)']
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const COLOR_PRESETS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#ec4899', '#f97316',
]

interface EditMedicationClientProps {
  medication: Medication
  originalSchedules: Schedule[]
}

function scheduleToFormEntry(s: Schedule): ScheduleFormEntry & { id: string } {
  return {
    id: s.id,
    timeOfDay: s.time_of_day.slice(0, 5), // 'HH:MM'
    recurrence: s.recurrence,
    daysOfWeek: s.days_of_week ?? [],
  }
}

export default function EditMedicationClient({ medication, originalSchedules }: EditMedicationClientProps) {
  const router = useRouter()
  const [name, setName] = useState(medication.name)
  const [doseAmount, setDoseAmount] = useState(String(medication.dose_amount))
  const [doseUnit, setDoseUnit] = useState(medication.dose_unit)
  const [form, setForm] = useState<MedicationForm>(medication.form)
  const [instructions, setInstructions] = useState(medication.instructions ?? '')
  const [colorTag, setColorTag] = useState(medication.color_tag)
  const [schedules, setSchedules] = useState<(ScheduleFormEntry & { id?: string })[]>(
    originalSchedules.map(scheduleToFormEntry)
  )
  const [tabletsRemaining, setTabletsRemaining] = useState(
    medication.tablets_remaining !== null ? String(medication.tablets_remaining) : ''
  )
  const [tabletsPerDose, setTabletsPerDose] = useState(String(medication.tablets_per_dose ?? 1))
  const [refillAlertDays, setRefillAlertDays] = useState(String(medication.refill_alert_days ?? 3))
  const [durationEndDate, setDurationEndDate] = useState(medication.duration_end_date ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  // Compute daily intake
  const dailySchedulesCount = schedules.reduce((acc, s) => {
    if (s.recurrence === 'daily') return acc + 1
    return acc + (s.daysOfWeek.length / 7)
  }, 0)
  const dailyUnitsConsumed = dailySchedulesCount * (Number(tabletsPerDose) || 1)
  const estimatedDaysLeft =
    tabletsRemaining && dailyUnitsConsumed > 0
      ? Math.floor(Number(tabletsRemaining) / dailyUnitsConsumed)
      : null

  function setPresetDuration(days: number | null) {
    if (days === null) {
      setDurationEndDate('')
    } else {
      const d = new Date()
      d.setDate(d.getDate() + days)
      setDurationEndDate(d.toISOString().split('T')[0])
    }
  }

  function validate(): boolean {
    const errors: Record<string, string> = {}
    if (!name.trim()) errors.name = 'Medication name is required'
    if (!doseAmount || Number(doseAmount) <= 0) errors.doseAmount = 'Dose amount must be > 0'
    if (schedules.length === 0) errors.schedules = 'At least one schedule is required'
    schedules.forEach((s, i) => {
      if (s.recurrence === 'specific_days' && s.daysOfWeek.length === 0) {
        errors[`schedule_${i}_days`] = 'Select at least one day'
      }
    })
    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    setSubmitting(true)

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    // Update medication
    const { error: medError } = await supabase
      .from('medications')
      .update({
        name: name.trim(),
        dose_amount: Number(doseAmount),
        dose_unit: doseUnit,
        form,
        instructions: instructions.trim() || null,
        color_tag: colorTag,
        tablets_remaining: tabletsRemaining ? Number(tabletsRemaining) : null,
        tablets_per_dose: Number(tabletsPerDose) > 0 ? Number(tabletsPerDose) : 1,
        refill_alert_days: Number(refillAlertDays) > 0 ? Number(refillAlertDays) : 3,
        duration_end_date: durationEndDate || null,
      })
      .eq('id', medication.id)

    if (medError) {
      toast.error('Failed to update medication')
      setSubmitting(false)
      return
    }

    // Schedule diffing:
    const originalIds = new Set(originalSchedules.map((s) => s.id))
    const currentIds = new Set(schedules.filter((s) => s.id).map((s) => s.id!))

    // Delete removed schedules
    const toDelete = [...originalIds].filter((id) => !currentIds.has(id))
    if (toDelete.length > 0) {
      await supabase.from('schedules').delete().in('id', toDelete)
    }

    // Update existing schedules
    for (const s of schedules) {
      if (s.id && originalIds.has(s.id)) {
        await supabase
          .from('schedules')
          .update({
            time_of_day: s.timeOfDay + ':00',
            recurrence: s.recurrence,
            days_of_week: s.recurrence === 'specific_days' ? s.daysOfWeek : null,
            end_date: durationEndDate || null,
          })
          .eq('id', s.id)
      }
    }

    // Insert new schedules (no id)
    const newSchedules = schedules.filter((s) => !s.id)
    if (newSchedules.length > 0) {
      await supabase.from('schedules').insert(
        newSchedules.map((s) => ({
          medication_id: medication.id,
          user_id: user.id,
          time_of_day: s.timeOfDay + ':00',
          recurrence: s.recurrence,
          days_of_week: s.recurrence === 'specific_days' ? s.daysOfWeek : null,
          end_date: durationEndDate || null,
        }))
      )
    }

    toast.success('Medication updated!')
    router.push('/medications')
    router.refresh()
  }

  function addSchedule() {
    setSchedules((prev) => [...prev, { timeOfDay: '08:00', recurrence: 'daily', daysOfWeek: [] }])
  }

  function setDosesPerDay(count: number) {
    let newTimes: string[] = []
    if (count === 1) newTimes = ['09:00']
    else if (count === 2) newTimes = ['08:00', '20:00']
    else if (count === 3) newTimes = ['08:00', '14:00', '20:00']
    else if (count === 4) newTimes = ['08:00', '12:00', '16:00', '20:00']

    setSchedules(
      newTimes.map((time, idx) => ({
        id: schedules[idx]?.id,
        timeOfDay: time,
        recurrence: 'daily',
        daysOfWeek: [],
      }))
    )
  }

  function removeSchedule(i: number) {
    setSchedules((prev) => prev.filter((_, idx) => idx !== i))
  }

  function updateSchedule(i: number, patch: Partial<ScheduleFormEntry>) {
    setSchedules((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }

  function toggleDay(schedIdx: number, day: number) {
    const s = schedules[schedIdx]
    const days = s.daysOfWeek.includes(day)
      ? s.daysOfWeek.filter((d) => d !== day)
      : [...s.daysOfWeek, day].sort()
    updateSchedule(schedIdx, { daysOfWeek: days })
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link href="/medications" className="text-sm text-gray-500 hover:text-gray-700">
          ← Back to medications
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">Edit Medication</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Medication Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Medication Name *</Label>
              <MedicationAutocomplete
                id="name"
                value={name}
                onChange={setName}
                placeholder="e.g. Ibuprofen, Paracetamol, Amoxicillin"
                disabled={submitting}
              />
              {formErrors.name && <p className="text-xs text-red-600">{formErrors.name}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Dose Amount *</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={doseAmount}
                  onChange={(e) => setDoseAmount(e.target.value)}
                  disabled={submitting}
                />
                {formErrors.doseAmount && <p className="text-xs text-red-600">{formErrors.doseAmount}</p>}
              </div>
              <div className="space-y-2">
                <Label>Dose Unit</Label>
                <Select value={doseUnit} onValueChange={(v) => v && setDoseUnit(v)} disabled={submitting}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DOSE_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Form</Label>
              <Select value={form} onValueChange={(v) => setForm(v as MedicationForm)} disabled={submitting}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FORM_OPTIONS.map((f) => (
                    <SelectItem key={f} value={f} className="capitalize">{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Instructions (optional)</Label>
              <Input
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                disabled={submitting}
              />
            </div>

            <div className="space-y-2">
              <Label>Color Tag</Label>
              <div className="flex gap-2 flex-wrap">
                {COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColorTag(c)}
                    className={`w-8 h-8 rounded-full border-2 transition-transform ${colorTag === c ? 'border-gray-900 scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
                <input
                  type="color"
                  value={colorTag}
                  onChange={(e) => setColorTag(e.target.value)}
                  className="w-8 h-8 rounded cursor-pointer border border-gray-300"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Reminder Schedules</CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={addSchedule} disabled={submitting}>
                + Add Time
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Frequency selection */}
            <div className="space-y-2 pb-2">
              <Label className="text-sm font-semibold text-gray-800">
                How many times per day do you take this medicine?
              </Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { count: 1, label: 'Once daily', sub: '1 time / day' },
                  { count: 2, label: 'Twice daily', sub: '2 times / day' },
                  { count: 3, label: '3 times daily', sub: '3 times / day' },
                  { count: 4, label: '4 times daily', sub: '4 times / day' },
                ].map((item) => (
                  <Button
                    key={item.count}
                    type="button"
                    variant={schedules.length === item.count ? 'default' : 'outline'}
                    className={`h-auto py-2 px-3 flex flex-col items-center justify-center text-center ${
                      schedules.length === item.count
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-gray-200 hover:border-blue-300'
                    }`}
                    onClick={() => setDosesPerDay(item.count)}
                  >
                    <span className="font-semibold text-xs">{item.label}</span>
                    <span className="text-[10px] opacity-80">{item.sub}</span>
                  </Button>
                ))}
              </div>
              <p className="text-xs text-gray-500">
                Selecting a frequency sets up the times below. You can adjust the exact time for each dose.
              </p>
            </div>

            <Separator className="my-2" />

            {formErrors.schedules && <p className="text-xs text-red-600">{formErrors.schedules}</p>}
            {schedules.map((s, i) => (
              <div key={i}>
                {i > 0 && <Separator className="my-4" />}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">Schedule {i + 1}</Label>
                    {schedules.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-red-500 h-7 px-2"
                        onClick={() => removeSchedule(i)}
                        disabled={submitting}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs text-gray-600">Time</Label>
                      <Input
                        type="time"
                        value={s.timeOfDay}
                        onChange={(e) => updateSchedule(i, { timeOfDay: e.target.value })}
                        disabled={submitting}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs text-gray-600">Recurrence</Label>
                      <Select
                        value={s.recurrence}
                        onValueChange={(v) => updateSchedule(i, { recurrence: v as Recurrence, daysOfWeek: [] })}
                        disabled={submitting}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="daily">Every day</SelectItem>
                          <SelectItem value="specific_days">Specific days</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {s.recurrence === 'specific_days' && (
                    <div className="space-y-2">
                      <Label className="text-xs text-gray-600">Days of Week</Label>
                      <div className="flex gap-2 flex-wrap">
                        {DAY_LABELS.map((label, day) => (
                          <label
                            key={day}
                            className={`flex items-center justify-center w-10 h-10 rounded-full text-xs font-medium cursor-pointer border-2 transition-colors ${
                              s.daysOfWeek.includes(day)
                                ? 'bg-blue-600 border-blue-600 text-white'
                                : 'border-gray-300 text-gray-600 hover:border-blue-400'
                            }`}
                          >
                            <Checkbox
                              checked={s.daysOfWeek.includes(day)}
                              onCheckedChange={() => toggleDay(i, day)}
                              className="sr-only"
                              disabled={submitting}
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                      {formErrors[`schedule_${i}_days`] && (
                        <p className="text-xs text-red-600">{formErrors[`schedule_${i}_days`]}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Treatment Duration (Until when to take) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">📅 Treatment Duration</CardTitle>
            <p className="text-xs text-gray-500">
              Till when do you need to take this medicine? Extend or adjust if your doctor changed your prescription.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="durationEndDate">Take Until Date</Label>
              <Input
                id="durationEndDate"
                type="date"
                value={durationEndDate}
                onChange={(e) => setDurationEndDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                disabled={submitting}
              />
              <p className="text-xs text-gray-500">
                {durationEndDate
                  ? `Active until ${new Date(durationEndDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                  : 'Currently set to ongoing / continuous (no end date)'}
              </p>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-gray-600">Quick Presets</Label>
              <div className="flex gap-2 flex-wrap">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => setPresetDuration(7)}
                >
                  +7 Days
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => setPresetDuration(14)}
                >
                  +14 Days
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => setPresetDuration(30)}
                >
                  +30 Days
                </Button>
                <Button
                  type="button"
                  variant={!durationEndDate ? 'default' : 'outline'}
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => setPresetDuration(null)}
                >
                  Ongoing / No End Date
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tablet Inventory & Refill Alert Tracker */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">📦 Tablet Inventory & Refill Alert</CardTitle>
            <p className="text-xs text-gray-500">
              Track how many tablets you have left and receive refill warnings before you run out.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="tabletsRemaining">Tablets on Hand (Supply)</Label>
                <Input
                  id="tabletsRemaining"
                  type="number"
                  min="0"
                  step="0.5"
                  placeholder="e.g. 30"
                  value={tabletsRemaining}
                  onChange={(e) => setTabletsRemaining(e.target.value)}
                  disabled={submitting}
                />
                <p className="text-[11px] text-gray-500">Optional. Leave blank if unmetered.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="tabletsPerDose">Tablets per Dose</Label>
                <Input
                  id="tabletsPerDose"
                  type="number"
                  min="0.25"
                  step="0.25"
                  value={tabletsPerDose}
                  onChange={(e) => setTabletsPerDose(e.target.value)}
                  disabled={submitting}
                />
                <p className="text-[11px] text-gray-500">Units taken each dose</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="refillAlertDays">Refill Warning Threshold (Days)</Label>
              <Input
                id="refillAlertDays"
                type="number"
                min="1"
                max="14"
                value={refillAlertDays}
                onChange={(e) => setRefillAlertDays(e.target.value)}
                disabled={submitting}
                className="max-w-xs"
              />
              <p className="text-xs text-gray-500">
                You will be notified {refillAlertDays} days in advance and on the final day before running out.
              </p>
            </div>

            {tabletsRemaining && dailyUnitsConsumed > 0 && (
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-900 space-y-1">
                <p className="font-semibold">📊 Calculated Consumption:</p>
                <p>• Taking {tabletsPerDose} tablet(s) across {dailySchedulesCount.toFixed(1)} time(s) daily = <strong>{dailyUnitsConsumed.toFixed(1)} tablets/day</strong></p>
                <p>• Your {tabletsRemaining} tablets will last approximately <strong>{estimatedDaysLeft} days</strong></p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex gap-3 justify-end">
          <Link href="/medications">
            <Button type="button" variant="outline" disabled={submitting}>Cancel</Button>
          </Link>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </div>
  )
}
