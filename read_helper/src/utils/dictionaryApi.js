function uniqueBy(items, keySelector) {
  const map = new Map()

  for (const item of items) {
    const key = keySelector(item)

    if (!map.has(key)) {
      map.set(key, item)
    }
  }

  return Array.from(map.values())
}

function normalizeDefinition(definition) {
  return {
    definition: definition?.definition || '',
    example: definition?.example || '',
    synonyms: definition?.synonyms || [],
    antonyms: definition?.antonyms || [],
  }
}

function normalizeMeaning(meaning) {
  return {
    partOfSpeech: meaning?.partOfSpeech || 'unknown',
    definitions: (meaning?.definitions || []).map(normalizeDefinition),
    synonyms: meaning?.synonyms || [],
    antonyms: meaning?.antonyms || [],
  }
}

function normalizeEntry(entry, fallbackWord) {
  const phonetics = (entry?.phonetics || [])
    .map((phonetic) => ({
      text: phonetic?.text || '',
      audio: phonetic?.audio || '',
      sourceUrl: phonetic?.sourceUrl || '',
      license: phonetic?.license?.name || '',
    }))
    .filter((phonetic) => phonetic.text || phonetic.audio)

  return {
    word: entry?.word || fallbackWord,
    phonetic: entry?.phonetic || phonetics.find((phonetic) => phonetic.text)?.text || '',
    origin: entry?.origin || '',
    phonetics,
    meanings: (entry?.meanings || []).map(normalizeMeaning),
    sourceUrls: entry?.sourceUrls || [],
    license: entry?.license?.name || '',
  }
}

export async function fetchDictionaryEntry(word) {
  const query = word.trim()

  if (!query) {
    throw new Error('No word was selected.')
  }

  const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(query)}`)
  const data = await response.json().catch(() => null)

  if (!response.ok) {
    const message = data?.message || `No definition found for "${query}".`
    throw new Error(message)
  }

  const entries = Array.isArray(data) ? data : []

  if (entries.length === 0) {
    throw new Error(`No definition found for "${query}".`)
  }

  const normalizedEntries = entries.map((entry) => normalizeEntry(entry, query))
  const firstEntry = normalizedEntries[0]

  const mergedMeanings = normalizedEntries.flatMap((entry) => entry.meanings)
  const mergedPhonetics = uniqueBy(normalizedEntries.flatMap((entry) => entry.phonetics), (phonetic) => {
    return `${phonetic.text}|${phonetic.audio}`
  })
  const mergedSourceUrls = uniqueBy(
    normalizedEntries.flatMap((entry) => entry.sourceUrls).filter(Boolean),
    (url) => url,
  )

  const origins = uniqueBy(
    normalizedEntries.map((entry) => entry.origin).filter(Boolean),
    (origin) => origin,
  )

  return {
    word: firstEntry.word || query,
    phonetic: firstEntry.phonetic || mergedPhonetics.find((phonetic) => phonetic.text)?.text || '',
    origin: origins.join(' | '),
    phonetics: mergedPhonetics,
    meanings: mergedMeanings,
    sourceUrls: mergedSourceUrls,
    license: firstEntry.license,
  }
}