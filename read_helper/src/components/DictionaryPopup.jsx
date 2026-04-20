import { forwardRef, useCallback, useEffect, useRef, useState } from 'react'

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum)
}

const PANEL_MARGIN = 12
const MIN_WIDTH = 260
const MIN_HEIGHT = 180
const DEFAULT_WIDTH = 360
const DEFAULT_HEIGHT = 280
const COMPACT_POPUP_BREAKPOINT = 900

function isCompactPopupLayout() {
  if (typeof window === 'undefined') {
    return false
  }

  const isNarrowScreen = window.matchMedia?.(`(max-width: ${COMPACT_POPUP_BREAKPOINT}px)`)?.matches
    ?? window.innerWidth <= COMPACT_POPUP_BREAKPOINT
  const hasCoarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches ?? false

  return isNarrowScreen || hasCoarsePointer || Boolean(window.Capacitor)
}

function clampPanelToViewport(panel) {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const maxWidth = Math.max(MIN_WIDTH, viewportWidth - PANEL_MARGIN * 2)
  const maxHeight = Math.max(MIN_HEIGHT, viewportHeight - PANEL_MARGIN * 2)

  const width = clamp(panel.width, MIN_WIDTH, maxWidth)
  const height = clamp(panel.height, MIN_HEIGHT, maxHeight)
  const left = clamp(panel.left, PANEL_MARGIN, viewportWidth - width - PANEL_MARGIN)
  const top = clamp(panel.top, PANEL_MARGIN, viewportHeight - height - PANEL_MARGIN)

  return { left, top, width, height }
}

function createAnchoredPanel(anchorX, anchorY) {
  const viewportHeight = window.innerHeight
  const openAbove = anchorY > viewportHeight * 0.6

  return clampPanelToViewport({
    left: anchorX + 14,
    top: openAbove ? anchorY - DEFAULT_HEIGHT - 14 : anchorY + 14,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  })
}

function extractPrimaryDefinition(entry) {
  const firstMeaning = entry?.meanings?.[0]
  const firstDefinition = firstMeaning?.definitions?.[0]?.definition || ''

  if (!firstDefinition) {
    return ''
  }

  if (firstMeaning?.partOfSpeech) {
    return `${firstMeaning.partOfSpeech}: ${firstDefinition}`
  }

  return firstDefinition
}

function getBestPronunciationAudio(entry) {
  const phonetics = entry?.phonetics || []

  for (const phonetic of phonetics) {
    const rawAudio = (phonetic?.audio || '').trim()

    if (!rawAudio) {
      continue
    }

    if (rawAudio.startsWith('//')) {
      return `https:${rawAudio}`
    }

    return rawAudio
  }

  return ''
}

function DictionaryPopup({ popupState, onClose, canSaveWordNote = false, onAddWordNote }, ref) {
  const initialPanelRect = popupState
    ? createAnchoredPanel(popupState.anchorX ?? 0, popupState.anchorY ?? 0)
    : { left: 24, top: 24, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }

  const panelRef = useRef(null)
  const panelRectRef = useRef(initialPanelRect)
  const dragStateRef = useRef(null)
  const resizeStateRef = useRef(null)
  const hasUserAdjustedRef = useRef(false)
  const [panelRect, setPanelRect] = useState(initialPanelRect)
  const [phraseActionMessage, setPhraseActionMessage] = useState('')
  const [wordActionMessage, setWordActionMessage] = useState('')
  const [isCompactLayout, setIsCompactLayout] = useState(() => isCompactPopupLayout())
  const activeWordAudioRef = useRef(null)

  useEffect(() => {
    panelRectRef.current = panelRect
  }, [panelRect])

  const syncForwardedRef = useCallback(
    (node) => {
      panelRef.current = node

      if (typeof ref === 'function') {
        ref(node)
      } else if (ref) {
        ref.current = node
      }
    },
    [ref],
  )

  useEffect(() => {
    const handleViewportChange = () => {
      setIsCompactLayout(isCompactPopupLayout())
    }

    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('orientationchange', handleViewportChange)

    return () => {
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('orientationchange', handleViewportChange)
    }
  }, [])

  useEffect(() => {
    const handlePointerMove = (event) => {
      const dragState = dragStateRef.current

      if (dragState) {
        const deltaX = event.clientX - dragState.startX
        const deltaY = event.clientY - dragState.startY

        setPanelRect((currentRect) =>
          clampPanelToViewport({
            ...currentRect,
            left: dragState.originLeft + deltaX,
            top: dragState.originTop + deltaY,
          })
        )
        return
      }

      const resizeState = resizeStateRef.current

      if (resizeState) {
        const deltaX = event.clientX - resizeState.startX
        const deltaY = event.clientY - resizeState.startY

        setPanelRect((currentRect) =>
          clampPanelToViewport({
            ...currentRect,
            width: resizeState.originWidth + deltaX,
            height: resizeState.originHeight + deltaY,
          })
        )
      }
    }

    const handlePointerUp = () => {
      dragStateRef.current = null
      resizeStateRef.current = null
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [])

  useEffect(() => {
    if (!popupState) {
      hasUserAdjustedRef.current = false
      dragStateRef.current = null
      resizeStateRef.current = null
    }
  }, [popupState])

  useEffect(() => {
    return () => {
      activeWordAudioRef.current?.pause?.()
      activeWordAudioRef.current = null
      window.speechSynthesis?.cancel?.()
    }
  }, [])

  useEffect(() => {
    if (!popupState) {
      return
    }

    const handleWindowResize = () => {
      setPanelRect((currentRect) => clampPanelToViewport(currentRect))
    }

    window.addEventListener('resize', handleWindowResize)
    return () => window.removeEventListener('resize', handleWindowResize)
  }, [popupState])

  const startDragging = (event) => {
    if (isCompactLayout) {
      return
    }

    if (event.button !== 0) {
      return
    }

    if (event.target instanceof Element && event.target.closest('.dictionary-popup__close')) {
      return
    }

    event.preventDefault()
    hasUserAdjustedRef.current = true

    const currentRect = panelRectRef.current
    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originLeft: currentRect.left,
      originTop: currentRect.top,
    }
  }

  const startResizing = (event) => {
    if (isCompactLayout) {
      return
    }

    if (event.button !== 0) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    hasUserAdjustedRef.current = true

    const currentRect = panelRectRef.current
    resizeStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originWidth: currentRect.width,
      originHeight: currentRect.height,
    }
  }

  const copyPhraseExplanation = async () => {
    const content = popupState?.explanation?.trim()

    if (!content) {
      setPhraseActionMessage('Nothing to copy yet.')
      return
    }

    try {
      await navigator.clipboard.writeText(content)
      setPhraseActionMessage('Explanation copied.')
    } catch {
      setPhraseActionMessage('Copy failed on this device.')
    }
  }

  const readPhraseExplanation = () => {
    const content = popupState?.explanation?.trim()

    if (!content) {
      setPhraseActionMessage('Nothing to read aloud yet.')
      return
    }

    if (!('speechSynthesis' in window)) {
      setPhraseActionMessage('Read aloud is not supported here.')
      return
    }

    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(content)
    utterance.rate = 0.95
    utterance.pitch = 1
    utterance.lang = 'en-US'
    window.speechSynthesis.speak(utterance)
    setPhraseActionMessage('Reading aloud...')
  }

  const addWordNote = () => {
    const selectedWord = popupState?.selectedText?.trim()
    const selectedDefinition = extractPrimaryDefinition(popupState?.entry)

    if (!selectedWord) {
      setWordActionMessage('No word to save.')
      return
    }

    const saved = onAddWordNote?.(selectedWord, selectedDefinition)
    setWordActionMessage(saved ? 'Added to notes.' : 'Already in notes or unavailable.')
  }

  const speakWordFallback = (word) => {
    if (!('speechSynthesis' in window)) {
      setWordActionMessage('Pronunciation is not supported on this device.')
      return
    }

    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(word)
    utterance.rate = 0.95
    utterance.pitch = 1
    utterance.lang = 'en-US'
    window.speechSynthesis.speak(utterance)
    setWordActionMessage('Playing pronunciation...')
  }

  const pronounceWord = async () => {
    const selectedWord = popupState?.selectedText?.trim()

    if (!selectedWord) {
      setWordActionMessage('No word selected.')
      return
    }

    const audioUrl = getBestPronunciationAudio(popupState?.entry)

    if (!audioUrl) {
      speakWordFallback(selectedWord)
      return
    }

    try {
      activeWordAudioRef.current?.pause?.()
      const audio = new Audio(audioUrl)
      activeWordAudioRef.current = audio
      await audio.play()
      setWordActionMessage('Playing pronunciation...')
    } catch {
      speakWordFallback(selectedWord)
    }
  }

  if (!popupState) {
    return null
  }

  const isPhraseLookup = popupState.lookupType === 'phrase'

  return (
    <aside
      ref={syncForwardedRef}
      className={`dictionary-popup ${popupState.status === 'loading' ? 'is-loading' : ''}`}
      style={{
        left: panelRect.left,
        top: panelRect.top,
        width: panelRect.width,
        height: panelRect.height,
      }}
      role="dialog"
      aria-label="Dictionary popup"
    >
      <div className="dictionary-popup__header" onPointerDown={startDragging}>
        <div>
          <p className="dictionary-popup__eyebrow">
            {isPhraseLookup ? 'AI phrase explainer' : 'Dictionary'}
          </p>
          <h2>{isPhraseLookup ? 'Simple explanation' : popupState.selectedText}</h2>
        </div>

        <button type="button" className="dictionary-popup__close" onClick={onClose} aria-label="Close popup">
          X
        </button>
      </div>

      <div className="dictionary-popup__body">
        {popupState.status === 'loading' && (
          <p className="dictionary-popup__message">
            {isPhraseLookup ? 'Analyzing selected phrase...' : 'Fetching definition...'}
          </p>
        )}

        {popupState.status === 'error' && <p className="dictionary-popup__error">{popupState.error}</p>}

        {popupState.status === 'ready' && isPhraseLookup && (
          <div className="dictionary-popup__content">
            <p className="dictionary-popup__selected-phrase">{popupState.selectedText}</p>
            <p className="dictionary-popup__explanation">{popupState.explanation}</p>

            <div className="dictionary-popup__actions" role="group" aria-label="Explanation actions">
              <button type="button" onClick={copyPhraseExplanation}>
                Copy
              </button>
              <button type="button" onClick={readPhraseExplanation}>
                Read aloud
              </button>
            </div>

            {phraseActionMessage && <p className="dictionary-popup__meta">{phraseActionMessage}</p>}
            {popupState.source && <p className="dictionary-popup__source">{popupState.source}</p>}
          </div>
        )}

        {popupState.status === 'ready' && !isPhraseLookup && popupState.entry && (
          <div className="dictionary-popup__content">
            <div className="dictionary-popup__actions" role="group" aria-label="Word actions">
              <button type="button" onClick={pronounceWord}>
                Pronounce
              </button>

              {canSaveWordNote && (
                <button type="button" onClick={addWordNote}>
                  Add to notes
                </button>
              )}
            </div>

            {wordActionMessage && <p className="dictionary-popup__meta">{wordActionMessage}</p>}

            {popupState.entry.phonetic && <p className="dictionary-popup__phonetic">{popupState.entry.phonetic}</p>}

            {popupState.entry.origin && <p className="dictionary-popup__meta">Origin: {popupState.entry.origin}</p>}

            {popupState.entry.phonetics?.length > 0 && (
              <div className="dictionary-popup__metadata-block">
                <p className="dictionary-popup__meta-title">Phonetics</p>
                <ul className="dictionary-popup__metadata-list">
                  {popupState.entry.phonetics.map((phonetic, index) => (
                    <li key={`${phonetic.text}-${phonetic.audio}-${index}`}>
                      {phonetic.text && <span>{phonetic.text}</span>}
                      {phonetic.audio && (
                        <a href={phonetic.audio} target="_blank" rel="noreferrer">
                          audio
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="dictionary-popup__meanings">
              {popupState.entry.meanings.map((meaning, meaningIndex) => (
                <section key={`${meaning.partOfSpeech}-${meaningIndex}`} className="dictionary-popup__meaning">
                  <div className="dictionary-popup__meaning-head">
                    <span>{meaning.partOfSpeech}</span>
                  </div>

                  {meaning.synonyms?.length > 0 && (
                    <p className="dictionary-popup__meta">Synonyms: {meaning.synonyms.join(', ')}</p>
                  )}

                  {meaning.antonyms?.length > 0 && (
                    <p className="dictionary-popup__meta">Antonyms: {meaning.antonyms.join(', ')}</p>
                  )}

                  <ol>
                    {meaning.definitions.map((definition, definitionIndex) => (
                      <li key={`${definition.definition}-${definitionIndex}`} className="dictionary-popup__definition-item">
                        <p className="dictionary-popup__definition-text">{definition.definition}</p>

                        {definition.example && (
                          <p className="dictionary-popup__definition-example">Example: {definition.example}</p>
                        )}

                        {definition.synonyms?.length > 0 && (
                          <p className="dictionary-popup__definition-meta">
                            Synonyms: {definition.synonyms.join(', ')}
                          </p>
                        )}

                        {definition.antonyms?.length > 0 && (
                          <p className="dictionary-popup__definition-meta">
                            Antonyms: {definition.antonyms.join(', ')}
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </div>

            {popupState.entry.sourceUrls?.length > 0 && (
              <div className="dictionary-popup__metadata-block">
                <p className="dictionary-popup__meta-title">Sources</p>
                <ul className="dictionary-popup__metadata-list">
                  {popupState.entry.sourceUrls.map((sourceUrl, sourceIndex) => (
                    <li key={`${sourceUrl}-${sourceIndex}`}>
                      <a href={sourceUrl} target="_blank" rel="noreferrer">
                        {sourceUrl}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {popupState.entry.license && (
              <p className="dictionary-popup__meta">License: {popupState.entry.license}</p>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        className="dictionary-popup__resize-handle"
        onPointerDown={startResizing}
        aria-label="Resize popup"
      />
    </aside>
  )
}

export default forwardRef(DictionaryPopup)