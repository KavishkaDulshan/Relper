const OPENAI_COMPAT_ENDPOINT = 'https://text.pollinations.ai/openai'
const LEGACY_TEXT_ENDPOINT = 'https://text.pollinations.ai'
const DESKTOP_AI_ENDPOINT = '/api/ai/explain'
const PRIMARY_MODEL = 'openai-fast'
const SECONDARY_MODEL = 'openai'
const MAX_PHRASE_LENGTH = 420
const MAX_EXPLANATION_CHARS = 900
const MAX_SENTENCES = 4
const REQUEST_TIMEOUT_MS = 20000
const MAX_RETRIES_PER_ATTEMPT = 2

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'has',
  'have',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'were',
  'with',
  'will',
  'would',
])

const NOTICE_START_PATTERN =
  /important notice|legacy text api is being deprecated|deprecation notice|enter\.pollinations\.ai|anonymous requests to text\.pollinations\.ai/i

const LEADING_LABEL_PATTERN = /^(simple explanation|explanation|meaning)\s*[:-]\s*/i

function stripOuterQuotes(value) {
  return value.replace(/^['"]+|['"]+$/g, '').trim()
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizePhrase(phrase) {
  return stripOuterQuotes(phrase.replace(/\s+/g, ' ').trim()).slice(0, MAX_PHRASE_LENGTH)
}

function isDesktopRuntime() {
  if (typeof window === 'undefined') {
    return false
  }

  return new URLSearchParams(window.location.search).get('desktop') === '1'
}

function extractKeywords(phrase) {
  const tokens = phrase.toLowerCase().match(/[a-z][a-z'-]*/g) ?? []
  const uniqueKeywords = []

  for (const token of tokens) {
    if (STOP_WORDS.has(token)) {
      continue
    }

    if (!uniqueKeywords.includes(token)) {
      uniqueKeywords.push(token)
    }

    if (uniqueKeywords.length >= 3) {
      break
    }
  }

  return uniqueKeywords
}

function buildMeaningAndExample(meaning, example) {
  return `Meaning: ${meaning} Example: ${example}`
}

function findPatternBasedExplanation(phrase) {
  const normalized = stripOuterQuotes(phrase).toLowerCase()

  const patterns = [
    {
      pattern: /\bice\b.*\bbegin[s]?\s+to\s+melt\b|\bbegin[s]?\s+to\s+melt\b.*\bice\b/,
      meaning:
        'A hard or cold situation is starting to become softer, friendlier, or easier to deal with.',
      example:
        'Two people were not talking before, but now they share a small smile and begin to feel comfortable.',
    },
    {
      pattern: /\bbreakthrough\b|\bhuge change\b|\bturning point\b/,
      meaning: 'A big improvement happens after many small efforts.',
      example:
        'A student practices every day, and after weeks they suddenly solve difficult problems much faster.',
    },
    {
      pattern: /\bbuild\s+up\b|\bbuilds?\s+up\b|\bslowly\b.*\bchange\b/,
      meaning: 'Small actions collect over time and finally create a noticeable result.',
      example:
        'Saving a little money each week does not look big at first, but later it becomes a useful amount.',
    },
    {
      pattern: /\bcan(?:not|'t)?\b.*\badd\b.*\bcart\b|\badd\b.*\bcart\b.*\bfail/,
      meaning: 'Users are trying to add products, but the cart action does not work correctly.',
      example:
        'A shopper clicks Add to cart, but the cart number does not increase until they retry.',
    },
    {
      pattern: /\bno different\b|\bone-degree shift\b|\bsmall\b.*\bchange\b.*\bhuge\b/,
      meaning: 'A tiny change can still cause a very large effect later.',
      example:
        'Changing your study time by only ten minutes each day can greatly improve exam results in a month.',
    },
  ]

  for (const item of patterns) {
    if (item.pattern.test(normalized)) {
      return buildMeaningAndExample(item.meaning, item.example)
    }
  }

  return ''
}

function isLowValueExplanation(text) {
  const lower = text.toLowerCase()
  const weakSignals = [
    'nearby text helps confirm details',
    'depends on the surrounding context',
    'this phrase is mainly about',
    'expresses one short idea',
  ]

  let weakCount = 0

  for (const signal of weakSignals) {
    if (lower.includes(signal)) {
      weakCount += 1
    }
  }

  return weakCount >= 1
}

function buildHeuristicFallbackExplanation(phrase) {
  const patternBased = findPatternBasedExplanation(phrase)

  if (patternBased) {
    return patternBased
  }

  const lowerPhrase = phrase.toLowerCase()
  const keywords = extractKeywords(phrase)
  const mentionsIntermittent = /occasionally|sometimes|intermittent|from time to time/.test(lowerPhrase)
  const mentionsFailure = /cannot|can't|unable|fails|fail|error|problem/.test(lowerPhrase)
  const exampleLine = buildHeuristicExampleLine(phrase, keywords, mentionsIntermittent, mentionsFailure)

  if (mentionsIntermittent && mentionsFailure) {
    return `Meaning: This says there is a problem that happens only sometimes. Most of the time the action works, but now and then it fails. ${exampleLine}`
  }

  if (mentionsFailure) {
    return `Meaning: This says the action is not working at the moment. It may be blocked by a temporary issue or a missing condition. ${exampleLine}`
  }

  if (mentionsIntermittent) {
    return `Meaning: This says the situation does not happen all the time. It appears now and then. ${exampleLine}`
  }

  if (keywords.length > 0) {
    return `Meaning: This sentence is talking about ${keywords.join(', ')} in simple words. It describes what is happening or changing. ${exampleLine}`
  }

  return `Meaning: This sentence gives one clear idea in short form. It describes a real situation in plain language. ${exampleLine}`
}

function buildHeuristicExampleLine(phrase, keywords, mentionsIntermittent, mentionsFailure) {
  const concisePhrase = stripOuterQuotes(phrase).toLowerCase()

  if (mentionsIntermittent && mentionsFailure) {
    return 'Example: A user clicks "Add to cart" twice. It works in the morning but fails in the evening, so the issue is occasional.'
  }

  if (mentionsFailure) {
    return 'Example: You click a button and nothing happens, so the action is currently failing.'
  }

  if (mentionsIntermittent) {
    return 'Example: A notification appears on some days but not on others, so it is intermittent.'
  }

  if (concisePhrase.includes('add') && concisePhrase.includes('cart')) {
    return 'Example: A shopper picks a product, taps "Add to cart", and expects to see it in the basket list.'
  }

  if (keywords.length > 0) {
    return `Example: In a real app, this phrase usually points to a simple situation involving ${keywords[0]}.`
  }

  return 'Example: In simple words, it is describing what is happening in an everyday situation.'
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function truncateBySentenceCount(text, maxSentences) {
  const sentenceMatches = text.match(/[^.!?]+[.!?]?/g)

  if (!sentenceMatches || sentenceMatches.length <= maxSentences) {
    return text
  }

  return sentenceMatches
    .slice(0, maxSentences)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .join(' ')
}

function sanitizeExplanation(rawText, phrase) {
  const lines = rawText
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const usableLines = []

  for (const line of lines) {
    if (NOTICE_START_PATTERN.test(line)) {
      break
    }

    if (/^#{1,6}\s/.test(line)) {
      continue
    }

    usableLines.push(line)
  }

  let explanation = usableLines.join(' ').replace(/\s{2,}/g, ' ').trim()

  if (!explanation) {
    return ''
  }

  explanation = explanation.replace(/\*\*(.*?)\*\*/g, '$1').replace(LEADING_LABEL_PATTERN, '').trim()

  const normalizedPhrase = stripOuterQuotes(phrase)

  if (normalizedPhrase) {
    const escapedPhrase = escapeRegExp(normalizedPhrase)
    const leadingPhrasePattern = new RegExp(`^['"]?${escapedPhrase}['"]?\\s*[:,-]?\\s*`, 'i')
    explanation = explanation.replace(leadingPhrasePattern, '').trim()
  }

  explanation = explanation
    .replace(/\s*[-*]\s+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()

  const normalizedExplanation = stripOuterQuotes(explanation)

  if (!normalizedExplanation) {
    return ''
  }

  if (normalizedPhrase && normalizedExplanation.toLowerCase() === normalizedPhrase.toLowerCase()) {
    return ''
  }

  let condensed = truncateBySentenceCount(normalizedExplanation, MAX_SENTENCES)

  if (condensed.length > MAX_EXPLANATION_CHARS) {
    condensed = condensed.slice(0, MAX_EXPLANATION_CHARS).trim()
  }

  return ensureMeaningAndExample(condensed, phrase)
}

function normalizeSpaces(value) {
  return value.replace(/\s{2,}/g, ' ').trim()
}

function ensureMeaningAndExample(explanation, phrase) {
  const patternBased = findPatternBasedExplanation(phrase)
  let normalized = normalizeSpaces(explanation)

  if (!normalized) {
    return patternBased || ''
  }

  if (isLowValueExplanation(normalized) && patternBased) {
    normalized = patternBased
  }

  const startsWithMeaning = /^meaning\s*:/i.test(normalized)
  const hasExample = /(^|\s)example\s*:/i.test(normalized) || /for example/i.test(normalized)
  const keywords = extractKeywords(phrase)
  const lowerPhrase = phrase.toLowerCase()
  const mentionsIntermittent = /occasionally|sometimes|intermittent|from time to time/.test(lowerPhrase)
  const mentionsFailure = /cannot|can't|unable|fails|fail|error|problem/.test(lowerPhrase)

  let result = normalized

  if (!startsWithMeaning) {
    result = `Meaning: ${result}`
  }

  if (!hasExample) {
    const exampleLine = buildHeuristicExampleLine(phrase, keywords, mentionsIntermittent, mentionsFailure)
    result = `${result} ${exampleLine}`
  }

  if (isLowValueExplanation(result) && patternBased) {
    result = patternBased
  }

  const sentenceLimited = truncateBySentenceCount(result, MAX_SENTENCES)

  if (sentenceLimited.length > MAX_EXPLANATION_CHARS) {
    return sentenceLimited.slice(0, MAX_EXPLANATION_CHARS).trim()
  }

  return sentenceLimited
}

function buildSystemPrompt() {
  return [
    'You are a reading assistant.',
    'Explain selected text in very simple English for a beginner learner.',
    'Use short words and avoid jargon.',
    'Return exactly two parts: "Meaning:" and "Example:".',
    'The example must be practical and easy to imagine.',
    'Use 2 to 4 short sentences total.',
    'Do not include warnings, policy notices, or unrelated commentary.',
    'Return only the explanation text.',
  ].join(' ')
}

function buildUserPrompt(phrase) {
  return [
    `Phrase: "${phrase}"`,
    'Explain what this means in very simple English.',
    'Then add one simple real-life style example.',
    'Format:',
    'Meaning: ...',
    'Example: ...',
  ].join('\n')
}

function buildLegacyPrompt(phrase) {
  return [
    'You are a reading assistant.',
    'Explain this phrase in very simple English using 2 to 4 short sentences.',
    'Include exactly two parts: Meaning and Example.',
    'Return only the explanation text.',
    `Phrase: "${phrase}"`,
  ].join('\n')
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

async function requestOpenAiCompat(phrase, model) {
  const response = await fetchWithTimeout(OPENAI_COMPAT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: buildSystemPrompt(),
        },
        {
          role: 'user',
          content: buildUserPrompt(phrase),
        },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error('Primary AI endpoint failed.')
  }

  const data = await response.json().catch(() => null)
  return data?.choices?.[0]?.message?.content ?? ''
}

async function requestDesktopGroqExplanation(phrase) {
  const response = await fetchWithTimeout(DESKTOP_AI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      phrase,
    }),
  })

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => null)
    const message =
      typeof errorPayload?.error === 'string' && errorPayload.error.trim().length > 0
        ? errorPayload.error.trim()
        : `Desktop Groq endpoint failed (HTTP ${response.status}).`

    throw new Error(message)
  }

  const data = await response.json().catch(() => null)

  if (!data || typeof data.explanation !== 'string') {
    throw new Error('Desktop Groq endpoint returned no explanation.')
  }

  return data.explanation
}

async function requestLegacyFallback(phrase) {
  const prompt = buildLegacyPrompt(phrase)
  const response = await fetchWithTimeout(`${LEGACY_TEXT_ENDPOINT}/${encodeURIComponent(prompt)}`)

  if (!response.ok) {
    throw new Error('Fallback AI endpoint failed.')
  }

  return response.text()
}

export async function explainPhraseInSimpleTerms(phrase) {
  const normalizedPhrase = normalizePhrase(phrase)
  const desktopRuntime = isDesktopRuntime()

  if (!normalizedPhrase) {
    throw new Error('No phrase was selected for AI explanation.')
  }

  const attempts = desktopRuntime
    ? [
        {
          request: () => requestDesktopGroqExplanation(normalizedPhrase),
          source: 'Groq API (desktop)',
        },
      ]
    : [
        {
          request: () => requestOpenAiCompat(normalizedPhrase, PRIMARY_MODEL),
          source: 'Free AI model: Pollinations openai-fast',
        },
        {
          request: () => requestOpenAiCompat(normalizedPhrase, SECONDARY_MODEL),
          source: 'Free AI model: Pollinations openai',
        },
        {
          request: () => requestLegacyFallback(normalizedPhrase),
          source: 'Free AI model: Pollinations Text API',
        },
      ]

  let lastError = null

  for (const attempt of attempts) {
    for (let retryIndex = 0; retryIndex < MAX_RETRIES_PER_ATTEMPT; retryIndex += 1) {
      try {
        const rawContent = await attempt.request()
        const explanation = sanitizeExplanation(rawContent, normalizedPhrase)

        if (explanation) {
          return {
            explanation,
            source: attempt.source,
          }
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'AI request failed.'

        if (desktopRuntime) {
          break
        }
      }

      if (retryIndex + 1 < MAX_RETRIES_PER_ATTEMPT) {
        await sleep(300)
      }
    }

    if (desktopRuntime && lastError) {
      break
    }
  }

  if (desktopRuntime) {
    throw new Error(lastError || 'Groq request failed in desktop mode.')
  }

  return {
    explanation: buildHeuristicFallbackExplanation(normalizedPhrase),
    source: 'Fallback mode: Local explanation (AI endpoint temporarily unavailable)',
  }
}
