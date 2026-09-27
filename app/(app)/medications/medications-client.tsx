'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Medication } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'

interface MedicationsClientProps {
  initialMedications: Medication[]
}

export default function MedicationsClient({ initialMedications }: MedicationsClientProps) {
  const router = useRouter()
  const [medications, setMedications] = useState<Medication[]>(initialMedications)
  const [searchTerm, setSearchTerm] = useState('')
  const [activeOnly, setActiveOnly] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [refillMed, setRefillMed] = useState<Medication | null>(null)
  const [refillAmount, setRefillAmount] = useState('30')
  const [refilling, setRefilling] = useState(false)
  const [extendMed, setExtendMed] = useState<Medication | null>(null)
  const [extendDate, setExtendDate] = useState('')
  const [extending, setExtending] = useState(false)

  const filtered = medications.filter((m) => {
    const matchesSearch = m.name.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesActive = !activeOnly || m.is_active
    return matchesSearch && matchesActive
  })

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

  async function handleDelete() {
    if (!deleteId) return
    setDeleting(true)
    const supabase = createClient()

    const { error } = await supabase.from('medications').delete().eq('id', deleteId)
    if (error) {
      toast.error('Failed to delete medication')
    } else {
      setMedications((prev) => prev.filter((m) => m.id !== deleteId))
      toast.success('Medication deleted')
    }
    setDeleteId(null)
    setDeleting(false)
  }

  async function toggleActive(med: Medication) {
    const supabase = createClient()
    const { error } = await supabase
      .from('medications')
      .update({ is_active: !med.is_active })
      .eq('id', med.id)

    if (error) {
      toast.error('Failed to update medication')
    } else {
      setMedications((prev) =>
        prev.map((m) => (m.id === med.id ? { ...m, is_active: !m.is_active } : m))
      )
      toast.success(med.is_active ? 'Medication deactivated' : 'Medication activated')
      router.refresh()
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Medications</h1>
          <p className="text-gray-500 text-sm mt-1">Manage your medications and schedules</p>
        </div>
        <Link href="/medications/add">
          <Button>+ Add Medication</Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-6">
        <Input
          placeholder="Search medications…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="max-w-xs"
        />
        <Button
          variant={activeOnly ? 'default' : 'outline'}
          onClick={() => setActiveOnly((v) => !v)}
          size="sm"
        >
          {activeOnly ? '✓ Active only' : 'All medications'}
        </Button>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-5xl mb-3">💊</p>
          <p className="text-lg font-medium">No medications found</p>
          <p className="text-sm mt-1">
            {searchTerm ? 'Try a different search term' : 'Add your first medication to get started'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((med) => (
            <Card key={med.id} className={!med.is_active ? 'opacity-60' : ''}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0 mt-1"
                      style={{ backgroundColor: med.color_tag }}
                    />
                    <CardTitle className="text-base leading-tight">{med.name}</CardTitle>
                  </div>
                  <Badge variant={med.is_active ? 'default' : 'secondary'} className="text-xs whitespace-nowrap">
                    {med.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-600 mb-1">
                  <span className="font-medium">{med.dose_amount} {med.dose_unit}</span>
                  {' · '}
                  <span className="capitalize">{med.form}</span>
                </p>
                {med.instructions && (
                  <p className="text-xs text-gray-500 mb-3 line-clamp-2">{med.instructions}</p>
                )}
                {/* Supply & Duration Badges */}
                <div className="flex flex-wrap gap-1.5 my-2.5">
                  {med.tablets_remaining !== null && (
                    <Badge
                      variant="outline"
                      className={`text-xs ${
                        med.tablets_remaining <= (med.tablets_per_dose || 1)
                          ? 'bg-red-50 text-red-700 border-red-300 font-semibold'
                          : med.tablets_remaining <= (med.tablets_per_dose || 1) * (med.refill_alert_days || 3)
                          ? 'bg-yellow-50 text-yellow-800 border-yellow-300 font-semibold'
                          : 'bg-gray-50 text-gray-700 border-gray-200'
                      }`}
                    >
                      {med.tablets_remaining <= (med.tablets_per_dose || 1)
                        ? `🚨 ${med.tablets_remaining} left (Refill Now!)`
                        : med.tablets_remaining <= (med.tablets_per_dose || 1) * (med.refill_alert_days || 3)
                        ? `⚠️ Low: ${med.tablets_remaining} left`
                        : `📦 ${med.tablets_remaining} left`}
                    </Badge>
                  )}
                  {med.duration_end_date ? (
                    <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                      🗓️ Until {new Date(med.duration_end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs bg-gray-50 text-gray-500 border-gray-200">
                      🗓️ Ongoing
                    </Badge>
                  )}
                </div>

                {/* Quick actions for supply & duration */}
                <div className="flex gap-1.5 mb-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-blue-600 bg-blue-50/50 hover:bg-blue-100 flex-1"
                    onClick={() => {
                      setRefillMed(med)
                      setRefillAmount('30')
                    }}
                  >
                    + Refill
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-indigo-600 bg-indigo-50/50 hover:bg-indigo-100 flex-1"
                    onClick={() => {
                      setExtendMed(med)
                      setExtendDate(med.duration_end_date ?? '')
                    }}
                  >
                    Extend
                  </Button>
                </div>

                <div className="flex gap-2 mt-2">
                  <Link href={`/medications/${med.id}/edit`} className="flex-1">
                    <Button variant="outline" size="sm" className="w-full text-xs">Edit</Button>
                  </Link>
                  <Link href={`/medications/${med.id}/explain`} className="flex-1">
                    <Button variant="outline" size="sm" className="w-full text-xs">Explain</Button>
                  </Link>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => toggleActive(med)}
                    title={med.is_active ? 'Deactivate' : 'Activate'}
                  >
                    {med.is_active ? '⏸' : '▶'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-red-600 hover:bg-red-50"
                    onClick={() => setDeleteId(med.id)}
                    title="Delete"
                  >
                    🗑
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete medication?</DialogTitle>
            <DialogDescription>
              This will permanently delete the medication and all its schedules and logs. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Refill Dialog */}
      <Dialog open={!!refillMed} onOpenChange={(open) => !open && setRefillMed(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>📦 Refill {refillMed?.name}</DialogTitle>
            <DialogDescription>
              Got new tablets? Enter how many tablets you purchased or received to update your supply.
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
            <Button onClick={handleRefill} disabled={refilling || !refillAmount || Number(refillAmount) <= 0}>
              {refilling ? 'Updating Supply…' : `Add +${refillAmount || 0} to Stock`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Extend Duration Dialog */}
      <Dialog open={!!extendMed} onOpenChange={(open) => !open && setExtendMed(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>📅 Extend Prescription / Duration</DialogTitle>
            <DialogDescription>
              Did your doctor ask you to continue taking {extendMed?.name}? Update your treatment end date below.
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
                  ? `Reminders will continue until ${new Date(extendDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                  : 'No end date (continuous / ongoing reminders)'}
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
    </div>
  )
}
