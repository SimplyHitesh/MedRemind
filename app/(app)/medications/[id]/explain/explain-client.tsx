'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { ExplanationResponse } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

interface ExplainClientProps {
  medicationId: string
  medicationName: string
}

export default function ExplainClient({ medicationId, medicationName }: ExplainClientProps) {
  const [explanation, setExplanation] = useState<ExplanationResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cached, setCached] = useState(false)

  async function fetchExplanation(forceRefresh = false) {
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { data, error: fnError } = await supabase.functions.invoke('explain-medication', {
      body: { medication_name: medicationName, force_refresh: forceRefresh },
    })

    if (fnError) {
      setError(fnError.message || 'Failed to fetch medication information.')
      setLoading(false)
      return
    }

    if (data?.error) {
      setError(data.error.message || 'An error occurred.')
      setLoading(false)
      return
    }

    setExplanation(data as ExplanationResponse)
    setCached(data.source === 'cache')
    setLoading(false)
  }

  useEffect(() => {
    fetchExplanation()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [medicationName])

  const sourceConfig = {
    cache: { label: 'Cached', color: 'bg-blue-100 text-blue-800', emoji: '⚡' },
    openfda: { label: 'Live from OpenFDA', color: 'bg-green-100 text-green-800', emoji: '🌐' },
    fallback: { label: 'No data found', color: 'bg-orange-100 text-orange-800', emoji: '⚠️' },
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link href="/medications" className="text-sm text-gray-500 hover:text-gray-700">
          ← Back to medications
        </Link>
        <div className="flex items-start justify-between mt-2">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{medicationName}</h1>
            <p className="text-gray-500 text-sm mt-1">Medication information from OpenFDA</p>
          </div>
          <Link href={`/medications/${medicationId}/edit`}>
            <Button variant="outline" size="sm">Edit</Button>
          </Link>
        </div>
      </div>

      {loading && (
        <div className="flex flex-col items-center py-16 text-gray-400">
          <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4" />
          <p className="text-sm">Looking up medication information…</p>
        </div>
      )}

      {error && !loading && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-6 text-center">
            <p className="text-red-700 font-medium mb-2">⚠️ Could not fetch information</p>
            <p className="text-red-600 text-sm mb-4">{error}</p>
            <Button variant="outline" onClick={() => fetchExplanation()}>Try again</Button>
          </CardContent>
        </Card>
      )}

      {explanation && !loading && (
        <div className="space-y-4">
          {/* Source badge + refresh */}
          <div className="flex items-center justify-between">
            {(() => {
              const cfg = sourceConfig[explanation.source]
              return (
                <Badge variant="outline" className={`text-xs border-0 ${cfg.color}`}>
                  {cfg.emoji} {cfg.label}
                </Badge>
              )
            })()}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fetchExplanation(true)}
              className="text-gray-500 text-xs"
            >
              🔄 Refresh
            </Button>
          </div>

          {/* Names */}
          {(explanation.data.brand_name || explanation.data.generic_name) && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Names</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {explanation.data.brand_name && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Brand Name</p>
                    <p className="font-medium text-gray-900">{explanation.data.brand_name}</p>
                  </div>
                )}
                {explanation.data.generic_name && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Generic Name</p>
                    <p className="font-medium text-gray-900">{explanation.data.generic_name}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Purpose */}
          {explanation.data.purpose && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">💊 Purpose</CardTitle></CardHeader>
              <CardContent>
                <p className="text-gray-700 text-sm leading-relaxed">{explanation.data.purpose}</p>
              </CardContent>
            </Card>
          )}

          {/* Warnings */}
          {explanation.data.warnings && (
            <Card className={explanation.source === 'fallback' ? 'border-orange-200 bg-orange-50' : ''}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">⚠️ Warnings</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-700 text-sm leading-relaxed">{explanation.data.warnings}</p>
              </CardContent>
            </Card>
          )}

          {/* Side effects */}
          {explanation.data.side_effects.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">🩺 Common Side Effects</CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {explanation.data.side_effects.map((se, i) => (
                    <li key={i} className="flex gap-2 text-sm text-gray-700">
                      <span className="text-gray-400 flex-shrink-0">•</span>
                      <span>{se}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {explanation.source === 'fallback' && !explanation.data.purpose && explanation.data.side_effects.length === 0 && (
            <Card className="border-orange-200 bg-orange-50">
              <CardContent className="py-6 text-center">
                <p className="text-orange-700 text-sm">
                  No verified information found for <strong>{medicationName}</strong> in the OpenFDA database.
                  Always consult your pharmacist or prescribing doctor for accurate medication information.
                </p>
              </CardContent>
            </Card>
          )}

          <Separator />
          <p className="text-xs text-gray-400 text-center">
            {cached ? 'Cached data' : 'Data sourced from OpenFDA'} ·{' '}
            Last fetched: {new Date(explanation.data.fetched_at).toLocaleString()}
          </p>

          <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
            <p className="text-xs text-yellow-800">
              <strong>Disclaimer:</strong> This information is sourced from FDA drug labeling and is for informational purposes only.
              Always consult a licensed healthcare professional before making medication decisions.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
