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
  const [submitting, setSubmitting] = useState(false)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

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
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
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
