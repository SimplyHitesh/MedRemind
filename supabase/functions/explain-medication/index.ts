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

      if (cached && cached.source !== 'fallback') {
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

    // Step 2: Extract candidate terms (handles compound names, international synonyms, and dosage suffixes)
    const SYNONYMS: Record<string, string> = {
      paracetamol: 'acetaminophen',
      paracetemol: 'acetaminophen',
      panadol: 'acetaminophen',
      calpol: 'acetaminophen',
      tylenol: 'acetaminophen',
      salbutamol: 'albuterol',
      ventolin: 'albuterol',
      frusemide: 'furosemide',
      lasix: 'furosemide',
      lignocaine: 'lidocaine',
      glyceryl_trinitrate: 'nitroglycerin',
      amoxycillin: 'amoxicillin',
      amoxil: 'amoxicillin',
      adrenaline: 'epinephrine',
      noradrenaline: 'norepinephrine',
      rifampicin: 'rifampin',
      hyoscine: 'scopolamine',
      mepyramine: 'pyrilamine',
    }

    const cleanTerms: string[] = []
    const addTerm = (term: string, atFront = false) => {
      const trimmed = term.trim()
      if (trimmed.length >= 2 && !cleanTerms.some((t) => t.toLowerCase() === trimmed.toLowerCase())) {
        if (atFront) {
          cleanTerms.unshift(trimmed)
        } else {
          cleanTerms.push(trimmed)
        }
      }
    }

    const rawParts = medication_name
      .split(/[\(\)\/\,\+]/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2)

    for (const part of rawParts) {
      const syn = SYNONYMS[part.toLowerCase().replace(/[^a-z0-9]/g, '_')] || SYNONYMS[part.toLowerCase()]
      if (syn) {
        addTerm(syn, true)
      }

      const strippedDosage = part.replace(/\b\d+(\.\d+)?\s*(mg|mcg|g|ml|tablets?|capsules?|pills?|mcg\/ml)\b/gi, '').trim()
      if (strippedDosage && strippedDosage.length >= 2 && strippedDosage !== part) {
        const synStripped = SYNONYMS[strippedDosage.toLowerCase().replace(/[^a-z0-9]/g, '_')] || SYNONYMS[strippedDosage.toLowerCase()]
        if (synStripped) {
          addTerm(synStripped, true)
        }
        addTerm(strippedDosage)
      }

      addTerm(part)
    }

    if (cleanTerms.length === 0) {
      cleanTerms.push(medication_name.trim())
    }

    const openFdaBase = Deno.env.get('OPENFDA_API_BASE') ?? 'https://api.fda.gov/drug/label.json'
    let results: Record<string, unknown>[] = []
    let fdaData: Record<string, unknown> | null = null
    let matchedTerm = cleanTerms[0] || medication_name

    // Pass 1: Match against openfda indexed fields (brand, generic, substance) with OR
    for (const term of cleanTerms) {
      const enc = encodeURIComponent(term)
      const query1Url = `${openFdaBase}?search=openfda.brand_name:"${enc}"+OR+openfda.generic_name:"${enc}"+OR+openfda.substance_name:"${enc}"&limit=1`
      try {
        const resp1 = await fetch(query1Url, {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(6000),
        })
        if (resp1.ok) {
          const json1 = await resp1.json()
          if (json1.results && json1.results.length > 0) {
            results = json1.results
            fdaData = json1
            matchedTerm = term
            break
          }
        }
      } catch {
        // continue
      }
    }

    // Pass 2: If Pass 1 found nothing, try full-text search across all label sections
    if (results.length === 0) {
      for (const term of cleanTerms) {
        const enc = encodeURIComponent(term)
        const query2Url = `${openFdaBase}?search="${enc}"&limit=1`
        try {
          const resp2 = await fetch(query2Url, {
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(6000),
          })
          if (resp2.ok) {
            const json2 = await resp2.json()
            if (json2.results && json2.results.length > 0) {
              results = json2.results
              fdaData = json2
              matchedTerm = term
              break
            }
          }
        } catch {
          // continue
        }
      }
    }

    let explanation: Record<string, unknown>
    let source: string
    let expiresAt: string

    if (results.length > 0) {
      const drug = results[0] as Record<string, unknown>
      const openfda = (drug.openfda as Record<string, string[]>) ?? {}

      const brandName = openfda.brand_name?.[0] ?? matchedTerm
      const genericName = openfda.generic_name?.[0] ?? openfda.substance_name?.[0] ?? null
      const purpose =
        (drug.purpose as string[])?.[0] ??
        (drug.indications_and_usage as string[])?.[0] ??
        (drug.description as string[])?.[0] ??
        null
      const warnings =
        (drug.warnings as string[])?.[0] ??
        (drug.warnings_and_cautions as string[])?.[0] ??
        (drug.boxed_warning as string[])?.[0] ??
        (drug.precautions as string[])?.[0] ??
        null
      const adverseRaw =
        (drug.adverse_reactions as string[])?.[0] ??
        (drug.side_effects as string[])?.[0] ??
        ''
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
        warnings: 'No verified FDA label found for this medication name. Consult your pharmacist or physician for guidance.',
        side_effects: [],
        source: 'fallback',
        raw_response: null,
      }
      source = 'fallback'
      expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()
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
