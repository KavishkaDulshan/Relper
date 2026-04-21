const DESKTOP_AI_CONFIG_ENDPOINT = '/api/ai/config'
const DEFAULT_DESKTOP_AI_MODEL = 'llama-3.3-70b-versatile'

async function parseConfigResponse(response, fallbackMessage) {
  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const errorMessage =
      typeof payload?.error === 'string' && payload.error.trim().length > 0
        ? payload.error.trim()
        : fallbackMessage

    throw new Error(errorMessage)
  }

  return payload ?? {}
}

function normalizeDesktopAiConfig(payload) {
  return {
    hasApiKey: Boolean(payload?.hasApiKey),
    apiKeyPreview: typeof payload?.apiKeyPreview === 'string' ? payload.apiKeyPreview : '',
    model:
      typeof payload?.model === 'string' && payload.model.trim().length > 0
        ? payload.model.trim()
        : DEFAULT_DESKTOP_AI_MODEL,
  }
}

export async function fetchDesktopAiConfig() {
  const response = await fetch(DESKTOP_AI_CONFIG_ENDPOINT, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  })

  const payload = await parseConfigResponse(response, 'Could not load desktop AI settings.')
  return normalizeDesktopAiConfig(payload)
}

export async function saveDesktopAiConfig({ apiKey, model }) {
  const response = await fetch(DESKTOP_AI_CONFIG_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      apiKey,
      model,
    }),
  })

  const payload = await parseConfigResponse(response, 'Could not save desktop AI settings.')
  return normalizeDesktopAiConfig(payload)
}

export async function clearDesktopAiConfig() {
  const response = await fetch(DESKTOP_AI_CONFIG_ENDPOINT, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
    },
  })

  const payload = await parseConfigResponse(response, 'Could not clear desktop AI settings.')
  return normalizeDesktopAiConfig(payload)
}

export { DEFAULT_DESKTOP_AI_MODEL }
