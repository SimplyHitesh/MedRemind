import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RequestBody {
  medication_name: string
  force_refresh?: boolean
}

interface ExplanationData {
  brand_name: string | null
  generic_name: string | null
  purpose: string | null
  warnings: string | null
  side_effects: string[]
  fetched_at: string
}

function truncateToThreeSentences(text: string): string[] {
  if (!text) return []
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0)
  return sentences.slice(0, 3)
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Parse and validate request body
    let body: RequestBody
    try {
      body = await req.json()
    } catch {
      return new Response(
        JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'Invalid JSON body' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { medication_name, force_refresh = false } = body

    if (!medication_name || typeof medication_name !== 'string' || medication_name.trim().length === 0 || medication_name.trim().length > 200) {
      return new Response(
        JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'medication_name must be a non-empty string (1-200 chars)' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Normalize
    const queryKey = medication_name.trim().toLowerCase()

    // Init Supabase with service role (to write to medication_explanations)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Step 1: Check cache (unless force_refresh)
    if (!force_refresh) {
      const { data: cached } = await supabase
        .from('medication_explanations')
        .select('*')
        .eq('query_key', queryKey)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle()

      if (cached) {
        const data: ExplanationData = {
          brand_name: cached.brand_name,
          generic_name: cached.generic_name,
          purpose: cached.purpose,
          warnings: cached.warnings,
          side_effects: cached.side_effects ?? [],
          fetched_at: cached.fetched_at,
        }
        return new Response(
          JSON.stringify({ source: 'cache', data }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // Step 2: Call OpenFDA
    const openFdaBase = Deno.env.get('OPENFDA_API_BASE') ?? 'https://api.fda.gov/drug/label.json'
    const encodedName = encodeURIComponent(queryKey)
    const fdaUrl = `${openFdaBase}?search=openfda.brand_name:"${encodedName}"+openfda.generic_name:"${encodedName}"&limit=1`

    let fdaData: Record<string, unknown> | null = null
    let lastError: Error | null = null

    // 1 retry
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fdaResp = await fetch(fdaUrl, {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(10000),
        })

        if (fdaResp.ok) {
          fdaData = await fdaResp.json()
          break
        } else if (fdaResp.status === 404) {
          // No results - treat as zero results, don't retry
          fdaData = { results: [] }
          break
        } else {
          throw new Error(`OpenFDA returned ${fdaResp.status}`)
        }
      } catch (err) {
        lastError = err as Error
        if (attempt === 0) {
          // Wait 1 second before retry
          await new Promise((r) => setTimeout(r, 1000))
        }
      }
    }

    // If both attempts failed with network/5xx error
    if (fdaData === null) {
      console.error('OpenFDA unreachable after retry:', lastError?.message)
      return new Response(
        JSON.stringify({ error: { code: 'UPSTREAM_ERROR', message: 'Unable to reach OpenFDA API. Please try again later.' } }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const results = (fdaData as { results?: unknown[] }).results ?? []

    let explanation: Record<string, unknown>
    let source: string
    let expiresAt: string

    if (results.length > 0) {
      const drug = results[0] as Record<string, unknown>
      const openfda = (drug.openfda as Record<string, string[]>) ?? {}

      const brandName = openfda.brand_name?.[0] ?? null
      const genericName = openfda.generic_name?.[0] ?? null
      const purpose = (drug.purpose as string[])?.[0] ?? null
      const warnings = (drug.warnings as string[])?.[0] ?? (drug.warnings_and_cautions as string[])?.[0] ?? null
      const adverseRaw = (drug.adverse_reactions as string[])?.[0] ?? ''
      const sideEffects = truncateToThreeSentences(adverseRaw)

      explanation = {
        query_key: queryKey,
        brand_name: brandName,
        generic_name: genericName,
        purpose,
        warnings,
        side_effects: sideEffects,
        source: 'openfda',
        raw_response: fdaData,
      }
      source = 'openfda'
      expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    } else {
      // Fallback
      explanation = {
        query_key: queryKey,
        brand_name: null,
        generic_name: null,
        purpose: null,
        warnings: 'No verified data found for this medication name. Consult a pharmacist.',
        side_effects: [],
        source: 'fallback',
        raw_response: null,
      }
      source = 'fallback'
      expiresAt = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString()
    }

    // Upsert into cache
    const now = new Date().toISOString()
    await supabase
      .from('medication_explanations')
      .upsert(
        { ...explanation, fetched_at: now, expires_at: expiresAt },
        { onConflict: 'query_key' }
      )

    const data: ExplanationData = {
      brand_name: explanation.brand_name as string | null,
      generic_name: explanation.generic_name as string | null,
      purpose: explanation.purpose as string | null,
      warnings: explanation.warnings as string | null,
      side_effects: explanation.side_effects as string[],
      fetched_at: now,
    }

    return new Response(
      JSON.stringify({ source, data }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('explain-medication unexpected error:', err)
    return new Response(
      JSON.stringify({ error: { code: 'UPSTREAM_ERROR', message: 'Internal server error' } }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
