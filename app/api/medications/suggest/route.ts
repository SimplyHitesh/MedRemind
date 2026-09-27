import { NextResponse, type NextRequest } from 'next/server'

interface RxTermsResponse {
  0: number
  1: string[]
  2: unknown
  3: unknown
}

// Common international -> US name mappings
const COMMON_SYNONYMS: Record<string, string> = {
  paracetamol: 'Acetaminophen (Tylenol)',
  paracetemol: 'Acetaminophen (Paracetamol / Tylenol)',
  salbutamol: 'Albuterol',
  frusemide: 'Furosemide',
  lignocaine: 'Lidocaine',
  glyceryl_trinitrate: 'Nitroglycerin',
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')?.trim() ?? ''

  if (query.length < 2) {
    return NextResponse.json({ suggestions: [] })
  }

  const suggestions: string[] = []
  const lowerQuery = query.toLowerCase()

  // 1. Check known international synonyms
  for (const [key, val] of Object.entries(COMMON_SYNONYMS)) {
    if (key.startsWith(lowerQuery) || lowerQuery.startsWith(key.slice(0, 4))) {
      suggestions.push(val)
    }
  }

  try {
    // 2. Fetch from NIH Clinical Tables RxTerms API (Fast, comprehensive US & international database)
    const url = `https://clinicaltables.nlm.nih.gov/api/rxterms/v3/search?terms=${encodeURIComponent(query)}&maxList=8`
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) })

    if (res.ok) {
      const data = (await res.json()) as RxTermsResponse
      const rawNames = data[1] ?? []

      for (const raw of rawNames) {
        // Strip form description like " (Oral Pill)" to get clean brand/generic name
        const clean = raw.replace(/\s*\([^)]*\)/g, '').trim()
        if (clean && !suggestions.some((s) => s.toLowerCase() === clean.toLowerCase())) {
          suggestions.push(clean)
        }
      }
    }
  } catch (err) {
    console.error('Error fetching drug autocomplete suggestions:', err)
  }

  // 3. If no suggestions found, check RxNav spelling suggestions for typos (e.g. "paracetemol" -> "paracetamol")
  if (suggestions.length === 0 && query.length >= 3) {
    try {
      const spellUrl = `https://rxnav.nlm.nih.gov/REST/spellingsuggestions.json?name=${encodeURIComponent(query)}`
      const spellRes = await fetch(spellUrl, { signal: AbortSignal.timeout(2500) })
      if (spellRes.ok) {
        const spellData = await spellRes.json()
        const rawSuggestions = spellData?.suggestionGroup?.suggestionList?.suggestion ?? []
        const list = Array.isArray(rawSuggestions) ? rawSuggestions : [rawSuggestions]

        for (const item of list.filter(Boolean)) {
          // If paracetamol suggested, clarify with Acetaminophen
          if (item.toLowerCase() === 'paracetamol') {
            suggestions.push('Paracetamol (Acetaminophen)')
          } else {
            suggestions.push(item)
          }
        }
      }
    } catch {
      // Ignore spelling API timeout
    }
  }

  return NextResponse.json({
    suggestions: suggestions.slice(0, 8),
  })
}
