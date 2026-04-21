import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import DictionaryPopup from './components/DictionaryPopup.jsx'
import PdfViewer from './components/PdfViewer.jsx'
import { explainPhraseInSimpleTerms } from './utils/aiExplainApi.js'
import {
  clearDesktopAiConfig,
  DEFAULT_DESKTOP_AI_MODEL,
  fetchDesktopAiConfig,
  saveDesktopAiConfig,
} from './utils/desktopAiConfigApi.js'
import { fetchDictionaryEntry } from './utils/dictionaryApi.js'
import { getSelectionContext } from './utils/selectionUtils.js'

const MIN_SCALE = 0.8
const MAX_SCALE = 2.8
const SCALE_STEP = 0.2
const DEFAULT_SCALE = 1.5
const MOBILE_DEFAULT_SCALE = 1.1
const MOBILE_BREAKPOINT = 900
const DESKTOP_NOTES_STORAGE_KEY = 'read-helper-desktop-notes-v1'
const SELECTION_CHANGE_DEBOUNCE_MS = 220
const DUPLICATE_LOOKUP_WINDOW_MS = 700
const CONTROLS_AUTO_HIDE_DELAY_MS = 1400
const APP_DISPLAY_NAME = 'Relper'
const APP_LOGO_PATH = `${import.meta.env.BASE_URL}relper-logo.svg`
const GITHUB_REPOSITORY_URL = 'https://github.com/KavishkaDulshan/Relper'
const DESKTOP_RELEASE_ASSET_NAME = 'RelperDesktop-Windows.zip'
const GITHUB_DESKTOP_DOWNLOAD_URL = `${GITHUB_REPOSITORY_URL}/releases/latest/download/${DESKTOP_RELEASE_ASSET_NAME}`

function clampScale(value) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(value.toFixed(2))))
}

function buildPdfKey(file) {
  if (!file) {
    return ''
  }

  return `${file.name}|${file.size}|${file.lastModified}`
}

function isCompactLayoutViewport() {
  if (typeof window === 'undefined') {
    return false
  }

  const isNarrowScreen = window.matchMedia?.(`(max-width: ${MOBILE_BREAKPOINT}px)`)?.matches
    ?? window.innerWidth <= MOBILE_BREAKPOINT
  const hasCoarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches ?? false

  return isNarrowScreen || hasCoarsePointer || Boolean(window.Capacitor)
}

function getDefaultScaleForViewport() {
  if (typeof window !== 'undefined' && window.Capacitor) {
    return 1
  }

  return isCompactLayoutViewport() ? MOBILE_DEFAULT_SCALE : DEFAULT_SCALE
}

function getDefaultStatusMessage(isCompactLayout) {
  if (isCompactLayout) {
    return 'Choose a local PDF, then tap and hold a word for quick help. Pinch to zoom.'
  }

  return 'Choose a local PDF, then highlight a word for quick help.'
}

function ReaderApp() {
  const [pdfFile, setPdfFile] = useState(null)
  const [popupState, setPopupState] = useState(null)
  const [scale, setScale] = useState(() => getDefaultScaleForViewport())
  const [pageCount, setPageCount] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [isCompactLayout, setIsCompactLayout] = useState(() => isCompactLayoutViewport())
  const [areReaderControlsVisible, setAreReaderControlsVisible] = useState(true)
  const [highContrast, setHighContrast] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }

    return window.localStorage.getItem('read-helper-high-contrast') === '1'
  })
  const [isDesktopApp] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }

    return new URLSearchParams(window.location.search).get('desktop') === '1'
  })
  const [isNativeApp] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }

    return Boolean(window.Capacitor)
  })
  const [desktopAiConfig, setDesktopAiConfig] = useState({
    isLoading: isDesktopApp,
    hasApiKey: false,
    apiKeyPreview: '',
    model: DEFAULT_DESKTOP_AI_MODEL,
    error: '',
  })
  const [isAiSettingsOpen, setIsAiSettingsOpen] = useState(false)
  const [isAiSettingsSaving, setIsAiSettingsSaving] = useState(false)
  const [aiSettingsApiKey, setAiSettingsApiKey] = useState('')
  const [aiSettingsModel, setAiSettingsModel] = useState(DEFAULT_DESKTOP_AI_MODEL)
  const [aiSettingsError, setAiSettingsError] = useState('')
  const [aiSettingsSuccess, setAiSettingsSuccess] = useState('')
  const aiAnalysisEnabled = isNativeApp || (isDesktopApp && desktopAiConfig.hasApiKey)
  const [isNotesCollapsed, setIsNotesCollapsed] = useState(() => isCompactLayoutViewport())
  const [activeNoteWord, setActiveNoteWord] = useState('')
  const [notesByPdf, setNotesByPdf] = useState(() => {
    if (typeof window === 'undefined') {
      return {}
    }

    try {
      const stored = window.localStorage.getItem(DESKTOP_NOTES_STORAGE_KEY)
      return stored ? JSON.parse(stored) : {}
    } catch {
      return {}
    }
  })
  const [statusMessage, setStatusMessage] = useState(() => getDefaultStatusMessage(isCompactLayoutViewport()))
  const viewerRef = useRef(null)
  const popupRef = useRef(null)
  const fileInputRef = useRef(null)
  const controlsHideTimerRef = useRef(null)
  const activeRequestId = useRef(0)
  const lastLookupSignatureRef = useRef('')
  const lastLookupAtRef = useRef(0)
  const notesEnabled = true
  const useContinuousScroll = true

  const refreshDesktopAiConfig = useCallback(async () => {
    if (!isDesktopApp) {
      return
    }

    setDesktopAiConfig((previous) => ({
      ...previous,
      isLoading: true,
      error: '',
    }))

    try {
      const config = await fetchDesktopAiConfig()

      setDesktopAiConfig({
        isLoading: false,
        hasApiKey: config.hasApiKey,
        apiKeyPreview: config.apiKeyPreview,
        model: config.model,
        error: '',
      })
      setAiSettingsModel(config.model)

      if (!config.hasApiKey) {
        setStatusMessage('Add your Groq API key in AI settings to enable phrase explanations.')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load desktop AI settings.'

      setDesktopAiConfig((previous) => ({
        ...previous,
        isLoading: false,
        error: message,
      }))
    }
  }, [isDesktopApp])

  useEffect(() => {
    void refreshDesktopAiConfig()
  }, [refreshDesktopAiConfig])

  const openAiSettingsDialog = useCallback(() => {
    setAiSettingsApiKey('')
    setAiSettingsModel(desktopAiConfig.model || DEFAULT_DESKTOP_AI_MODEL)
    setAiSettingsError('')
    setAiSettingsSuccess('')
    setIsAiSettingsOpen(true)
  }, [desktopAiConfig.model])

  const closeAiSettingsDialog = useCallback(() => {
    if (isAiSettingsSaving) {
      return
    }

    setIsAiSettingsOpen(false)
  }, [isAiSettingsSaving])

  const handleSaveAiSettings = useCallback(async (event) => {
    event.preventDefault()

    if (!isDesktopApp || isAiSettingsSaving) {
      return
    }

    const normalizedApiKey = aiSettingsApiKey.trim()
    const normalizedModel = aiSettingsModel.trim() || DEFAULT_DESKTOP_AI_MODEL

    if (!normalizedApiKey) {
      setAiSettingsSuccess('')
      setAiSettingsError('Groq API key is required.')
      return
    }

    if (!normalizedApiKey.startsWith('gsk_')) {
      setAiSettingsSuccess('')
      setAiSettingsError('Groq API key must start with gsk_.')
      return
    }

    setIsAiSettingsSaving(true)
    setAiSettingsError('')
    setAiSettingsSuccess('')

    try {
      const config = await saveDesktopAiConfig({
        apiKey: normalizedApiKey,
        model: normalizedModel,
      })

      setDesktopAiConfig({
        isLoading: false,
        hasApiKey: config.hasApiKey,
        apiKeyPreview: config.apiKeyPreview,
        model: config.model,
        error: '',
      })
      setAiSettingsApiKey('')
      setAiSettingsModel(config.model)
      setAiSettingsSuccess(`Saved. Using model ${config.model}.`)
      setStatusMessage('Groq API key saved. Phrase explanations are enabled.')
    } catch (error) {
      setAiSettingsError(error instanceof Error ? error.message : 'Could not save desktop AI settings.')
    } finally {
      setIsAiSettingsSaving(false)
    }
  }, [aiSettingsApiKey, aiSettingsModel, isAiSettingsSaving, isDesktopApp])

  const handleClearAiSettings = useCallback(async () => {
    if (!isDesktopApp || isAiSettingsSaving) {
      return
    }

    setIsAiSettingsSaving(true)
    setAiSettingsError('')
    setAiSettingsSuccess('')

    try {
      const config = await clearDesktopAiConfig()

      setDesktopAiConfig({
        isLoading: false,
        hasApiKey: config.hasApiKey,
        apiKeyPreview: config.apiKeyPreview,
        model: config.model,
        error: '',
      })
      setAiSettingsApiKey('')
      setAiSettingsModel(config.model)
      setAiSettingsSuccess('AI key removed. Add your key again when you need phrase explanations.')
      setStatusMessage('Groq API key removed. Add a key in AI settings to enable phrase explanations.')
    } catch (error) {
      setAiSettingsError(error instanceof Error ? error.message : 'Could not remove desktop AI settings.')
    } finally {
      setIsAiSettingsSaving(false)
    }
  }, [isAiSettingsSaving, isDesktopApp])

  useEffect(() => {
    if (!isAiSettingsOpen) {
      return undefined
    }

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        closeAiSettingsDialog()
      }
    }

    window.addEventListener('keydown', handleEscape)

    return () => {
      window.removeEventListener('keydown', handleEscape)
    }
  }, [closeAiSettingsDialog, isAiSettingsOpen])

  useEffect(() => {
    const handleViewportChange = () => {
      const compactLayout = isCompactLayoutViewport()
      setIsCompactLayout(compactLayout)

      if (compactLayout) {
        setIsNotesCollapsed(true)
      } else {
        setAreReaderControlsVisible(true)
      }
    }

    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('orientationchange', handleViewportChange)

    return () => {
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('orientationchange', handleViewportChange)
    }
  }, [])

  const clearControlsHideTimer = useCallback(() => {
    if (controlsHideTimerRef.current !== null) {
      window.clearTimeout(controlsHideTimerRef.current)
      controlsHideTimerRef.current = null
    }
  }, [])

  const revealReaderControls = useCallback(() => {
    if (!pdfFile || !isCompactLayout) {
      return
    }

    setAreReaderControlsVisible(true)
    clearControlsHideTimer()

    controlsHideTimerRef.current = window.setTimeout(() => {
      setAreReaderControlsVisible(false)
    }, CONTROLS_AUTO_HIDE_DELAY_MS)
  }, [clearControlsHideTimer, isCompactLayout, pdfFile])

  useEffect(() => {
    if (!pdfFile || !isCompactLayout) {
      clearControlsHideTimer()
      return undefined
    }

    const viewerNode = viewerRef.current

    if (!viewerNode) {
      return undefined
    }

    const handleReaderInteraction = () => {
      revealReaderControls()
    }

    viewerNode.addEventListener('scroll', handleReaderInteraction, { passive: true })
    viewerNode.addEventListener('pointerdown', handleReaderInteraction)

    const initialRevealTimer = window.setTimeout(() => {
      revealReaderControls()
    }, 0)

    return () => {
      window.clearTimeout(initialRevealTimer)
      viewerNode.removeEventListener('scroll', handleReaderInteraction)
      viewerNode.removeEventListener('pointerdown', handleReaderInteraction)
      clearControlsHideTimer()
    }
  }, [clearControlsHideTimer, isCompactLayout, pdfFile, revealReaderControls])

  useEffect(() => {
    let selectionTimer = null
    const supportsCoarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches ?? false
    const shouldWatchSelectionChanges = supportsCoarsePointer || Boolean(window.Capacitor)

    const requestLookupFromSelection = async ({
      anchorX,
      anchorY,
      eventTarget,
      selectionOverride = null,
    }) => {
      const targetElement =
        eventTarget instanceof Element
          ? eventTarget
          : eventTarget instanceof Node
            ? eventTarget.parentElement
            : null

      if (targetElement) {
        if (popupRef.current?.contains(targetElement) || targetElement.closest('[data-ignore-selection="true"]')) {
          return
        }
      }

      const selection = selectionOverride || window.getSelection()

      if (!viewerRef.current || !selection) {
        return
      }

      const resolvedAnchorX = Number.isFinite(anchorX) ? anchorX : window.innerWidth / 2
      const resolvedAnchorY = Number.isFinite(anchorY) ? anchorY : window.innerHeight / 2

      const selectionContext = getSelectionContext({
        selection,
        mouseEvent: {
          clientX: resolvedAnchorX,
          clientY: resolvedAnchorY,
        },
        containerElement: viewerRef.current,
      })

      if (!selectionContext) {
        return
      }

      const selectedText = selectionContext.text
      const isPhraseSelection = selectionContext.type === 'phrase'

      if (isPhraseSelection && !aiAnalysisEnabled) {
        setStatusMessage(
          isDesktopApp
            ? 'Add your Groq API key in AI settings to enable phrase explanations.'
            : 'AI phrase analysis is unavailable in the web app. Select a single word for definition.'
        )
        return
      }

      const normalizedSignature = `${selectionContext.type}:${selectedText.toLowerCase()}`
      const now = Date.now()

      if (
        normalizedSignature === lastLookupSignatureRef.current
        && now - lastLookupAtRef.current < DUPLICATE_LOOKUP_WINDOW_MS
      ) {
        return
      }

      lastLookupSignatureRef.current = normalizedSignature
      lastLookupAtRef.current = now

      const requestId = activeRequestId.current + 1
      activeRequestId.current = requestId

      setStatusMessage(
        isPhraseSelection
          ? isDesktopApp
            ? 'Analyzing selected phrase with Groq AI...'
            : 'Analyzing selected phrase with AI...'
          : `Looking up "${selectedText}"...`
      )

      setPopupState({
        id: requestId,
        anchorX: resolvedAnchorX,
        anchorY: resolvedAnchorY,
        lookupType: selectionContext.type,
        selectedText,
        status: 'loading',
        entry: null,
        explanation: '',
        source: '',
        error: null,
      })

      try {
        if (isPhraseSelection) {
          const aiResult = await explainPhraseInSimpleTerms(selectedText)

          if (activeRequestId.current !== requestId) {
            return
          }

          setPopupState({
            id: requestId,
            anchorX: resolvedAnchorX,
            anchorY: resolvedAnchorY,
            lookupType: 'phrase',
            selectedText,
            status: 'ready',
            entry: null,
            explanation: aiResult.explanation,
            source: aiResult.source,
            error: null,
          })
          setStatusMessage(
            aiResult.source.startsWith('Fallback mode')
              ? 'Showing a local fallback explanation for the selected phrase.'
              : isDesktopApp
                ? 'Showing a Groq explanation for the selected phrase.'
                : 'Showing a simple AI explanation for the selected phrase.'
          )
          return
        }

        const entry = await fetchDictionaryEntry(selectedText)

        if (activeRequestId.current !== requestId) {
          return
        }

        setPopupState({
          id: requestId,
          anchorX: resolvedAnchorX,
          anchorY: resolvedAnchorY,
          lookupType: 'word',
          selectedText,
          status: 'ready',
          entry,
          explanation: '',
          source: 'Free Dictionary API',
          error: null,
        })
        setStatusMessage(`Showing the definition for "${selectedText}".`)
      } catch (error) {
        if (activeRequestId.current !== requestId) {
          return
        }

        setPopupState({
          id: requestId,
          anchorX: resolvedAnchorX,
          anchorY: resolvedAnchorY,
          lookupType: selectionContext.type,
          selectedText,
          status: 'error',
          entry: null,
          explanation: '',
          source: '',
          error: error instanceof Error ? error.message : 'Unable to load definition.',
        })
        setStatusMessage(
          isPhraseSelection
            ? 'Could not generate an AI explanation for that phrase.'
            : `Could not load a definition for "${selectedText}".`
        )
      }
    }

    const handleMouseUp = (event) => {
      void requestLookupFromSelection({
        anchorX: event.clientX,
        anchorY: event.clientY,
        eventTarget: event.target,
      })
    }

    const handleTouchEnd = (event) => {
      const touchPoint = event.changedTouches?.[0]

      if (!touchPoint) {
        return
      }

      void requestLookupFromSelection({
        anchorX: touchPoint.clientX,
        anchorY: touchPoint.clientY,
        eventTarget: event.target,
      })
    }

    const handleSelectionChange = () => {
      if (!shouldWatchSelectionChanges) {
        return
      }

      if (selectionTimer !== null) {
        window.clearTimeout(selectionTimer)
      }

      selectionTimer = window.setTimeout(() => {
        const selection = window.getSelection()

        if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !viewerRef.current) {
          return
        }

        const range = selection.getRangeAt(0)

        if (!viewerRef.current.contains(range.commonAncestorContainer)) {
          return
        }

        const rangeRect = range.getBoundingClientRect()
        const fallbackX = window.innerWidth / 2
        const fallbackY = window.innerHeight / 2

        const anchorX = Number.isFinite(rangeRect.left + rangeRect.width / 2)
          ? rangeRect.left + rangeRect.width / 2
          : fallbackX
        const anchorY = Number.isFinite(rangeRect.top + rangeRect.height / 2)
          ? rangeRect.top + rangeRect.height / 2
          : fallbackY

        void requestLookupFromSelection({
          anchorX,
          anchorY,
          eventTarget: range.commonAncestorContainer,
          selectionOverride: selection,
        })
      }, SELECTION_CHANGE_DEBOUNCE_MS)
    }

    const handlePointerDown = (event) => {
      if (popupRef.current && !popupRef.current.contains(event.target)) {
        setPopupState(null)
        setStatusMessage('Popup closed.')
      }
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setPopupState(null)
        setStatusMessage('Popup closed.')
      }
    }

    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('touchend', handleTouchEnd, { passive: true })
    document.addEventListener('selectionchange', handleSelectionChange)
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      if (selectionTimer !== null) {
        window.clearTimeout(selectionTimer)
      }

      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('touchend', handleTouchEnd)
      document.removeEventListener('selectionchange', handleSelectionChange)
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [aiAnalysisEnabled])

  const handleFileChange = (event) => {
    const nextFile = event.target.files?.[0] ?? null
    event.target.value = ''
    setPdfFile(nextFile)
    setPopupState(null)
    setScale(getDefaultScaleForViewport())
    setPageCount(0)
    setCurrentPage(1)
    setActiveNoteWord('')
    setAreReaderControlsVisible(true)
    activeRequestId.current += 1
    lastLookupSignatureRef.current = ''
    lastLookupAtRef.current = 0

    if (nextFile) {
      setStatusMessage(
        isNativeApp
          ? `Loaded ${nextFile.name}. Scroll continuously, pinch to zoom, and tap and hold text for quick help.`
          : isCompactLayout
            ? `Loaded ${nextFile.name}. Tap and hold a word for quick help.`
            : aiAnalysisEnabled
              ? `Loaded ${nextFile.name}. Highlight a word or phrase for quick help.`
              : `Loaded ${nextFile.name}. Highlight a word for quick help.`
      )
    } else {
      setStatusMessage(getDefaultStatusMessage(isCompactLayout))
    }
  }

  const popupKey = popupState ? `popup-${popupState.id}` : 'dictionary-popup-hidden'
  const currentPdfKey = buildPdfKey(pdfFile)
  const currentPdfNotes = useMemo(() => {
    return currentPdfKey ? notesByPdf[currentPdfKey] || [] : []
  }, [currentPdfKey, notesByPdf])
  const activeNote = currentPdfNotes.find((item) => item.word === activeNoteWord) || null

  useEffect(() => {
    window.localStorage.setItem('read-helper-high-contrast', highContrast ? '1' : '0')
  }, [highContrast])

  useEffect(() => {
    if (!notesEnabled) {
      return
    }

    window.localStorage.setItem(DESKTOP_NOTES_STORAGE_KEY, JSON.stringify(notesByPdf))
  }, [notesEnabled, notesByPdf])

  const goToPage = (targetPage) => {
    const clampedPage = Math.max(1, Math.min(pageCount || 1, targetPage))
    setCurrentPage(clampedPage)

    const pageNode = viewerRef.current?.querySelector?.(`[data-page-number="${clampedPage}"]`)
    pageNode?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }

  const addWordToNotes = (word, definition = '') => {
    if (!notesEnabled || !currentPdfKey || !word?.trim()) {
      return false
    }

    const normalizedWord = word.trim()
    const normalizedDefinition = definition.trim()
    let changed = false

    setNotesByPdf((previous) => {
      const existing = previous[currentPdfKey] || []
      const existingIndex = existing.findIndex((item) => item.word.toLowerCase() === normalizedWord.toLowerCase())

      if (existingIndex >= 0) {
        const currentItem = existing[existingIndex]

        if (!currentItem.definition && normalizedDefinition) {
          const nextItems = [...existing]
          nextItems[existingIndex] = {
            ...currentItem,
            definition: normalizedDefinition,
          }
          changed = true
          return {
            ...previous,
            [currentPdfKey]: nextItems,
          }
        }

        return previous
      }

      changed = true
      return {
        ...previous,
        [currentPdfKey]: [
          ...existing,
          {
            word: normalizedWord,
            definition: normalizedDefinition,
            createdAt: new Date().toISOString(),
          },
        ],
      }
    })

    setIsNotesCollapsed(false)
    setActiveNoteWord(normalizedWord)
    return changed
  }

  const removeWordFromNotes = (word) => {
    if (!currentPdfKey) {
      return
    }

    setNotesByPdf((previous) => {
      const existing = previous[currentPdfKey] || []
      const updated = existing.filter((item) => item.word !== word)

      return {
        ...previous,
        [currentPdfKey]: updated,
      }
    })

    if (activeNoteWord === word) {
      setActiveNoteWord('')
    }
  }

  const shellClasses = [
    'app-shell',
    pdfFile ? 'app-shell--reader' : 'app-shell--launch',
    highContrast ? 'app-shell--high-contrast' : '',
    isCompactLayout ? 'app-shell--compact' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const openPdfPicker = () => {
    fileInputRef.current?.click?.()
  }

  const toggleNotesPanel = () => {
    setIsNotesCollapsed((current) => !current)
  }

  const controlsHiddenClass = !areReaderControlsVisible ? 'is-hidden' : ''

  return (
    <div className={shellClasses}>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden-file-input"
        accept=".pdf,application/pdf"
        onChange={handleFileChange}
      />

      <p className="sr-only" aria-live="polite">
        {statusMessage}
      </p>

      {!pdfFile && (
        <main className="launch-screen" data-ignore-selection="true">
          <section className="launch-card">
            <div className="launch-card__brand">
              <img src={APP_LOGO_PATH} alt="Relper logo" className="launch-card__logo" />
              <p className="launch-card__eyebrow">{APP_DISPLAY_NAME}</p>
            </div>
            <h1 className="launch-card__title">Open a PDF and start reading</h1>
            <p className="launch-card__copy">
              {isDesktopApp && !desktopAiConfig.hasApiKey
                ? 'Select a local PDF to enter a clean, full-screen reading mode with quick definitions. Set up your Groq API key in AI settings to enable phrase explanations.'
                : aiAnalysisEnabled
                ? 'Select a local PDF to enter a clean, full-screen reading mode with quick definitions and phrase explanations.'
                : 'Select a local PDF to enter a clean, full-screen reading mode with quick definitions.'}
            </p>

            <div className="launch-card__actions">
              <button type="button" className="launch-card__open" onClick={openPdfPicker}>
                Select PDF
              </button>
              {isDesktopApp && (
                <button type="button" className="launch-card__secondary" onClick={openAiSettingsDialog}>
                  {desktopAiConfig.hasApiKey ? 'Groq settings' : 'Set Groq key'}
                </button>
              )}
              <button
                type="button"
                className={`launch-card__contrast ${highContrast ? 'is-active' : ''}`}
                onClick={() => setHighContrast((current) => !current)}
                aria-pressed={highContrast}
              >
                High contrast
              </button>
            </div>
          </section>
        </main>
      )}

      {pdfFile && (
        <>
          <main
            className={`workspace workspace--reader-fullscreen ${notesEnabled ? 'workspace--with-notes' : ''} ${notesEnabled && isNotesCollapsed ? 'workspace--notes-collapsed' : ''}`}
            onPointerDown={() => revealReaderControls()}
          >
            <section className="workspace__reader workspace__reader--fullscreen">
              <PdfViewer
                ref={viewerRef}
                file={pdfFile}
                scale={scale}
                currentPage={currentPage}
                onCurrentPageChange={setCurrentPage}
                onPageCountChange={setPageCount}
                onScaleChange={setScale}
                compactMode={isCompactLayout}
                continuousScroll={useContinuousScroll}
              />
            </section>

            {notesEnabled && !isNotesCollapsed && (
              <aside
                className="notes-panel"
                aria-label="Word notes"
                data-ignore-selection="true"
              >
                <div className="notes-panel__content">
                  <div className="notes-panel__header">
                    <p className="notes-panel__title">Word Notes</p>
                    <button type="button" className="notes-panel__close" onClick={() => setIsNotesCollapsed(true)}>
                      Close
                    </button>
                  </div>

                  <p className="notes-panel__subtitle">Saved for this PDF: {currentPdfNotes.length}</p>

                  {currentPdfNotes.length > 0 ? (
                    <>
                      <ul className="notes-panel__list">
                        {currentPdfNotes.map((item) => (
                          <li key={`${item.word}-${item.createdAt}`}>
                            <button
                              type="button"
                              className={`notes-panel__word ${activeNoteWord === item.word ? 'is-active' : ''}`}
                              onClick={() =>
                                setActiveNoteWord((current) => (current === item.word ? '' : item.word))
                              }
                              aria-expanded={activeNoteWord === item.word}
                            >
                              {item.word}
                            </button>
                            <button type="button" onClick={() => removeWordFromNotes(item.word)} aria-label={`Remove ${item.word} from notes`}>
                              Remove
                            </button>
                          </li>
                        ))}
                      </ul>

                      {activeNote && (
                        <div className="notes-panel__definition" role="region" aria-label={`Definition for ${activeNote.word}`}>
                          <p className="notes-panel__definition-title">{activeNote.word}</p>
                          <p className="notes-panel__definition-text">
                            {activeNote.definition || 'Definition was not available when this word was saved.'}
                          </p>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="notes-panel__empty">No notes yet. Use Add to notes on a word definition.</p>
                  )}
                </div>
              </aside>
            )}
          </main>

          <div className={`reader-top-actions ${controlsHiddenClass}`} data-ignore-selection="true">
            <button type="button" onClick={openPdfPicker}>Open PDF</button>
            {isDesktopApp && (
              <button type="button" onClick={openAiSettingsDialog}>
                {desktopAiConfig.hasApiKey ? 'Groq settings' : 'Set Groq key'}
              </button>
            )}
            {!isNativeApp && (
              <>
                <button
                  type="button"
                  onClick={() => setScale((current) => clampScale(current - SCALE_STEP))}
                  disabled={scale <= MIN_SCALE}
                >
                  -
                </button>
                <button
                  type="button"
                  onClick={() => setScale((current) => clampScale(current + SCALE_STEP))}
                  disabled={scale >= MAX_SCALE}
                >
                  +
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setHighContrast((current) => !current)}
              className={highContrast ? 'is-active' : ''}
              aria-pressed={highContrast}
            >
              Contrast
            </button>
          </div>

          {notesEnabled && (
            <button
              type="button"
              className={`reader-notes-button ${!isNotesCollapsed ? 'is-active' : ''}`}
              data-ignore-selection="true"
              onClick={toggleNotesPanel}
              aria-expanded={!isNotesCollapsed}
            >
              {isNotesCollapsed ? 'Notes' : 'Hide Notes'}
            </button>
          )}

          <button
            type="button"
            className={`reader-nav-button reader-nav-button--prev ${controlsHiddenClass}`}
            data-ignore-selection="true"
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage <= 1}
            aria-label="Previous page"
          >
            Prev
          </button>

          <button
            type="button"
            className={`reader-nav-button reader-nav-button--next ${controlsHiddenClass}`}
            data-ignore-selection="true"
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage >= pageCount || pageCount === 0}
            aria-label="Next page"
          >
            Next
          </button>
        </>
      )}

      {isDesktopApp && isAiSettingsOpen && (
        <div className="ai-settings-backdrop" role="presentation" onClick={closeAiSettingsDialog}>
          <section
            className="ai-settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-settings-title"
            aria-describedby="ai-settings-description"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="ai-settings-modal__header">
              <div>
                <p className="ai-settings-modal__eyebrow">Desktop AI</p>
                <h2 id="ai-settings-title">Groq API key</h2>
              </div>
              <button type="button" className="ai-settings-modal__close" onClick={closeAiSettingsDialog}>
                Close
              </button>
            </header>

            <p id="ai-settings-description" className="ai-settings-modal__description">
              Store your own Groq key on this Windows desktop build. The key stays local to this machine and is only used for phrase explanations.
            </p>

            {desktopAiConfig.isLoading && <p className="ai-settings-modal__note">Loading saved settings...</p>}
            {desktopAiConfig.error && <p className="ai-settings-modal__error">{desktopAiConfig.error}</p>}
            {desktopAiConfig.hasApiKey && (
              <p className="ai-settings-modal__note">
                Saved key detected: {desktopAiConfig.apiKeyPreview}. Current model: {desktopAiConfig.model}.
              </p>
            )}
            {aiSettingsError && <p className="ai-settings-modal__error">{aiSettingsError}</p>}
            {aiSettingsSuccess && <p className="ai-settings-modal__success">{aiSettingsSuccess}</p>}

            <form className="ai-settings-form" onSubmit={handleSaveAiSettings}>
              <label className="ai-settings-field">
                <span>Groq API key</span>
                <input
                  type="password"
                  value={aiSettingsApiKey}
                  onChange={(event) => setAiSettingsApiKey(event.target.value)}
                  placeholder="gsk_..."
                  autoComplete="off"
                  spellCheck="false"
                />
              </label>

              <label className="ai-settings-field">
                <span>Model</span>
                <input
                  type="text"
                  value={aiSettingsModel}
                  onChange={(event) => setAiSettingsModel(event.target.value)}
                  placeholder={DEFAULT_DESKTOP_AI_MODEL}
                  autoComplete="off"
                  spellCheck="false"
                />
              </label>

              <div className="ai-settings-modal__actions">
                <button type="submit" className="ai-settings-modal__primary" disabled={isAiSettingsSaving}>
                  {isAiSettingsSaving ? 'Saving...' : 'Save key'}
                </button>
                <button type="button" className="ai-settings-modal__secondary" onClick={handleClearAiSettings} disabled={isAiSettingsSaving}>
                  Remove key
                </button>
                <button type="button" className="ai-settings-modal__tertiary" onClick={closeAiSettingsDialog} disabled={isAiSettingsSaving}>
                  Cancel
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      <DictionaryPopup
        key={popupKey}
        ref={popupRef}
        popupState={popupState}
        onClose={() => setPopupState(null)}
        canSaveWordNote={notesEnabled}
        onAddWordNote={addWordToNotes}
      />
    </div>
  )
}

function LandingPage({ onOpenReader }) {
  return (
    <main className="landing-shell">
      <section className="landing-hero" aria-labelledby="landing-title">
        <p className="landing-hero__eyebrow">Open source reading tools</p>
        <h1 className="landing-hero__title" id="landing-title">Relper</h1>
        <p className="landing-hero__lede">
          A minimal PDF reader for the web and a downloadable desktop build for Windows.
          Free to use, free to remix, and built to stay small.
        </p>

        <div className="landing-hero__actions">
          <button type="button" className="landing-button landing-button--primary" onClick={onOpenReader}>
            Open web reader
          </button>
          <a className="landing-button landing-button--secondary" href={GITHUB_DESKTOP_DOWNLOAD_URL} target="_blank" rel="noreferrer">
            Download desktop
          </a>
        </div>

        <div className="landing-hero__meta" aria-label="Product highlights">
          <span>Local PDF reading</span>
          <span>Dictionary lookup</span>
          <span>Desktop release from GitHub</span>
        </div>
      </section>

      <section className="landing-grid" aria-label="Products">
        <article className="product-card">
          <p className="product-card__tag">Web</p>
          <h2>Browser reader</h2>
          <p>
            A clean web app for reading local PDFs and checking definitions without unnecessary noise.
          </p>
        </article>

        <article className="product-card">
          <p className="product-card__tag">Desktop</p>
          <h2>Windows app</h2>
          <p>
            The packaged desktop build lives on GitHub Releases so anyone can download the latest installer.
          </p>
        </article>

        <article className="product-card product-card--compact">
          <p className="product-card__tag">Source</p>
          <h2>Open code</h2>
          <p>
            The project stays transparent and easy to fork, rebuild, and publish on your own.
          </p>
        </article>
      </section>

      <footer className="landing-footer">
        <a href={GITHUB_REPOSITORY_URL} target="_blank" rel="noreferrer">
          View source on GitHub
        </a>
      </footer>
    </main>
  )
}

function App() {
  const [showReader, setShowReader] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }

    const params = new URLSearchParams(window.location.search)
    return params.get('desktop') === '1' || params.get('reader') === '1'
  })

  const openReader = useCallback(() => {
    if (typeof window !== 'undefined') {
      const currentUrl = new URL(window.location.href)
      currentUrl.searchParams.set('reader', '1')
      window.history.replaceState({}, '', `${currentUrl.pathname}?${currentUrl.searchParams.toString()}${currentUrl.hash}`)
    }

    setShowReader(true)
  }, [])

  return showReader ? <ReaderApp /> : <LandingPage onOpenReader={openReader} />
}

export default App
