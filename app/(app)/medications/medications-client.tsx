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

  const filtered = medications.filter((m) => {
    const matchesSearch = m.name.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesActive = !activeOnly || m.is_active
    return matchesSearch && matchesActive
  })

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
                <div className="flex gap-2 mt-3">
                  <Link href={`/medications/${med.id}/edit`} className="flex-1">
                    <Button variant="outline" size="sm" className="w-full">Edit</Button>
                  </Link>
                  <Link href={`/medications/${med.id}/explain`} className="flex-1">
                    <Button variant="outline" size="sm" className="w-full">Explain</Button>
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
    </div>
  )
}
