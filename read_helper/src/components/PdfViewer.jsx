import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import { GlobalWorkerOptions, TextLayer, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const MOBILE_BREAKPOINT = 900
const MOBILE_PIXEL_RATIO_CAP = 1.2
const DESKTOP_PIXEL_RATIO_CAP = 2
const MOBILE_MAX_CANVAS_PIXELS = 1_200_000
const DESKTOP_MAX_CANVAS_PIXELS = 4_000_000
const PAGE_RENDER_ROOT_MARGIN = '1400px 0px'
const MIN_OUTPUT_SCALE = 0.1

function isCompactReaderMode() {
  if (typeof window === 'undefined') {
    return false
  }

  const isNarrowScreen = window.matchMedia?.(`(max-width: ${MOBILE_BREAKPOINT}px)`)?.matches
    ?? window.innerWidth <= MOBILE_BREAKPOINT
  const hasCoarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches ?? false

  return isNarrowScreen || hasCoarsePointer || Boolean(window.Capacitor)
}

function readPdfAsArrayBuffer(file) {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer()
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result)
        return
      }

      reject(new Error('Could not read the selected PDF.'))
    }

    reader.onerror = () => {
      reject(reader.error || new Error('Could not read the selected PDF.'))
    }

    reader.readAsArrayBuffer(file)
  })
}

function getReadablePdfErrorMessage(error) {
  const fallbackMessage = 'Unable to load the selected PDF.'

  if (!(error instanceof Error)) {
    return fallbackMessage
  }

  const loweredMessage = error.message.toLowerCase()

  if (
    loweredMessage.includes('worker')
    || loweredMessage.includes('promise.withresolvers')
    || loweredMessage.includes('url.parse')
  ) {
    return 'PDF rendering is not supported by the current Android System WebView. Please update Android System WebView and try again.'
  }

  return error.message || fallbackMessage
}

function isEditableTarget(target) {
  return target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

function clampScale(value) {
  return Math.min(2.8, Math.max(0.8, Number(value.toFixed(2))))
}

function getPinchDistance(touches) {
  if (!touches || touches.length < 2) {
    return 0
  }

  const firstTouch = touches[0]
  const secondTouch = touches[1]
  const deltaX = firstTouch.clientX - secondTouch.clientX
  const deltaY = firstTouch.clientY - secondTouch.clientY

  return Math.hypot(deltaX, deltaY)
}

function PdfPage({
  pdfDocument,
  pageNumber,
  scale,
  pixelRatioCap,
  maxCanvasPixels,
  observerRootRef,
  singlePageMode,
  estimatedPageDimensions,
}) {
  const [pageError, setPageError] = useState('')
  const [isNearViewport, setIsNearViewport] = useState(singlePageMode)
  const [renderedSize, setRenderedSize] = useState(null)
  const pageRef = useRef(null)
  const canvasRef = useRef(null)
  const textLayerRef = useRef(null)

  const shouldRender = singlePageMode || isNearViewport

  const fallbackWidth = estimatedPageDimensions?.width || 640
  const fallbackHeight = estimatedPageDimensions?.height || 900
  const placeholderSize = renderedSize || {
    width: fallbackWidth,
    height: fallbackHeight,
  }

  const pageStyle = {
    '--scale-factor': scale,
    '--total-scale-factor': scale,
    '--scale-round-x': '1px',
    '--scale-round-y': '1px',
  }

  useEffect(() => {
    if (singlePageMode) {
      return undefined
    }

    const targetNode = pageRef.current

    const observerRoot = observerRootRef?.current || null

    if (!targetNode || !observerRoot) {
      return undefined
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        setIsNearViewport(entry?.isIntersecting ?? false)
      },
      {
        root: observerRoot,
        rootMargin: PAGE_RENDER_ROOT_MARGIN,
        threshold: 0.01,
      }
    )

    observer.observe(targetNode)

    return () => {
      observer.disconnect()
    }
  }, [observerRootRef, singlePageMode])

  useEffect(() => {
    let cancelled = false
    let renderTask = null
    let textLayerInstance = null

    const canvas = canvasRef.current
    const textLayerContainer = textLayerRef.current

    if (!shouldRender) {
      if (textLayerContainer) {
        textLayerContainer.innerHTML = ''
      }

      if (canvas) {
        const context = canvas.getContext('2d')
        context?.clearRect(0, 0, canvas.width, canvas.height)
        canvas.width = 0
        canvas.height = 0
        canvas.style.width = ''
        canvas.style.height = ''
      }
      return undefined
    }

    const renderPage = async () => {
      try {
        const page = await pdfDocument.getPage(pageNumber)

        if (cancelled || !canvas || !textLayerContainer) {
          return
        }

        const viewport = page.getViewport({ scale })
        const requestedOutputScale = Math.min(window.devicePixelRatio || 1, pixelRatioCap)
        const maxOutputScaleByArea = Math.sqrt(maxCanvasPixels / Math.max(1, viewport.width * viewport.height))
        const outputScale = Math.min(
          requestedOutputScale,
          Math.max(MIN_OUTPUT_SCALE, maxOutputScaleByArea)
        )
        const canvasContext = canvas.getContext('2d', { alpha: false })

        canvas.width = Math.max(1, Math.floor(viewport.width * outputScale))
        canvas.height = Math.max(1, Math.floor(viewport.height * outputScale))
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        setRenderedSize({ width: viewport.width, height: viewport.height })

        textLayerContainer.innerHTML = ''

        renderTask = page.render({
          canvasContext,
          viewport,
          transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
        })

        await renderTask.promise

        if (cancelled) {
          return
        }

        textLayerInstance = new TextLayer({
          textContentSource: page.streamTextContent({
            includeMarkedContent: false,
            disableNormalization: false,
          }),
          container: textLayerContainer,
          viewport,
        })

        await textLayerInstance.render()
        page.cleanup()
        setPageError('')
      } catch (error) {
        if (!cancelled) {
          setPageError(error instanceof Error ? error.message : 'Could not render this page.')
        }
      }
    }

    renderPage()

    return () => {
      cancelled = true
      renderTask?.cancel?.()
      textLayerInstance?.cancel?.()
    }
  }, [maxCanvasPixels, pageNumber, pdfDocument, pixelRatioCap, scale, shouldRender])

  return (
    <article ref={pageRef} className={`pdf-page ${shouldRender ? '' : 'pdf-page--placeholder'}`} style={pageStyle} aria-label={`Page ${pageNumber}`} data-page-number={pageNumber}>
      {shouldRender ? (
        <>
          <canvas ref={canvasRef} className="pdf-canvas" />
          <div ref={textLayerRef} className="text-layer textLayer" />
        </>
      ) : (
        <div
          className="pdf-page-placeholder"
          style={{
            width: `${placeholderSize.width}px`,
            height: `${placeholderSize.height}px`,
          }}
        />
      )}
      {pageError && <p className="pdf-error">{pageError}</p>}
    </article>
  )
}

function PdfViewer(
  {
    file,
    scale,
    currentPage,
    onCurrentPageChange,
    onPageCountChange,
    onScaleChange,
    compactMode = false,
    continuousScroll = false,
  },
  ref,
) {
  const [pdfDocument, setPdfDocument] = useState(null)
  const [pageCount, setPageCount] = useState(0)
  const [estimatedPageMetrics, setEstimatedPageMetrics] = useState(null)
  const [isCompactViewport, setIsCompactViewport] = useState(() => isCompactReaderMode())
  const [loadingState, setLoadingState] = useState({ status: 'idle', message: 'Choose a PDF to start reading.' })
  const viewerShellRef = useRef(null)
  const pinchStateRef = useRef({
    active: false,
    startDistance: 0,
    startScale: scale,
  })
  const latestScaleRef = useRef(scale)

  const useCompactRendering = compactMode || isCompactViewport
  const singlePageMode = !continuousScroll

  const pixelRatioCap = useCompactRendering ? MOBILE_PIXEL_RATIO_CAP : DESKTOP_PIXEL_RATIO_CAP
  const maxCanvasPixels = useCompactRendering ? MOBILE_MAX_CANVAS_PIXELS : DESKTOP_MAX_CANVAS_PIXELS

  const estimatedPageDimensions = useMemo(() => {
    if (!estimatedPageMetrics) {
      return null
    }

    const width = Math.max(280, estimatedPageMetrics.baseWidth * scale)
    return {
      width,
      height: width * estimatedPageMetrics.aspectRatio,
    }
  }, [estimatedPageMetrics, scale])

  const pagesToRender = useMemo(() => {
    if (!pageCount) {
      return []
    }

    if (singlePageMode) {
      const clampedPage = Math.max(1, Math.min(pageCount, currentPage || 1))
      return [clampedPage]
    }

    return Array.from({ length: pageCount }, (_, index) => index + 1)
  }, [currentPage, pageCount, singlePageMode])

  const setViewerRef = (node) => {
    viewerShellRef.current = node

    if (typeof ref === 'function') {
      ref(node)
    } else if (ref) {
      ref.current = node
    }
  }

  useEffect(() => {
    const handleViewportChange = () => {
      setIsCompactViewport(isCompactReaderMode())
    }

    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('orientationchange', handleViewportChange)

    return () => {
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('orientationchange', handleViewportChange)
    }
  }, [])

  useEffect(() => {
    latestScaleRef.current = scale
  }, [scale])

  useEffect(() => {
    if (!onScaleChange || !viewerShellRef.current) {
      return undefined
    }

    const viewerNode = viewerShellRef.current

    const resetPinch = () => {
      pinchStateRef.current.active = false
      pinchStateRef.current.startDistance = 0
      pinchStateRef.current.startScale = latestScaleRef.current
    }

    const beginPinch = (touches) => {
      const startDistance = getPinchDistance(touches)

      if (startDistance <= 0) {
        return
      }

      pinchStateRef.current.active = true
      pinchStateRef.current.startDistance = startDistance
      pinchStateRef.current.startScale = latestScaleRef.current
    }

    const handleTouchStart = (event) => {
      if (event.touches.length === 2) {
        event.preventDefault()
        beginPinch(event.touches)
      }
    }

    const handleTouchMove = (event) => {
      if (event.touches.length < 2) {
        return
      }

      event.preventDefault()

      if (!pinchStateRef.current.active) {
        beginPinch(event.touches)
      }

      const distance = getPinchDistance(event.touches)

      if (distance <= 0 || pinchStateRef.current.startDistance <= 0) {
        return
      }

      const nextScale = clampScale(
        pinchStateRef.current.startScale * (distance / pinchStateRef.current.startDistance)
      )

      if (Math.abs(nextScale - latestScaleRef.current) < 0.01) {
        return
      }

      latestScaleRef.current = nextScale
      onScaleChange(nextScale)
    }

    const handleTouchEnd = (event) => {
      if (event.touches.length < 2) {
        resetPinch()
      }
    }

    viewerNode.addEventListener('touchstart', handleTouchStart, { passive: false })
    viewerNode.addEventListener('touchmove', handleTouchMove, { passive: false })
    viewerNode.addEventListener('touchend', handleTouchEnd, { passive: false })
    viewerNode.addEventListener('touchcancel', resetPinch, { passive: false })

    return () => {
      viewerNode.removeEventListener('touchstart', handleTouchStart)
      viewerNode.removeEventListener('touchmove', handleTouchMove)
      viewerNode.removeEventListener('touchend', handleTouchEnd)
      viewerNode.removeEventListener('touchcancel', resetPinch)
    }
  }, [onScaleChange])

  useEffect(() => {
    if (!file) {
      return undefined
    }

    let cancelled = false
    let loadingTask = null
    let loadedDocument = null
    let objectUrl = null

    const loadPdf = async () => {
      try {
        setLoadingState({ status: 'loading', message: `Loading ${file.name || 'PDF'}...` })
        setEstimatedPageMetrics(null)

        const baseDocumentOptions = {
          useWorkerFetch: false,
          isOffscreenCanvasSupported: false,
          stopAtErrors: false,
          disableRange: true,
          disableStream: true,
          disableAutoFetch: true,
          maxImageSize: useCompactRendering ? 4_000_000 : 8_000_000,
          disableFontFace: useCompactRendering,
          useSystemFonts: true,
        }

        objectUrl = URL.createObjectURL(file)
        loadingTask = getDocument({
          ...baseDocumentOptions,
          url: objectUrl,
        })

        try {
          loadedDocument = await loadingTask.promise
        } catch {
          loadingTask?.destroy()
          loadingTask = null

          if (objectUrl) {
            URL.revokeObjectURL(objectUrl)
            objectUrl = null
          }

          const buffer = await readPdfAsArrayBuffer(file)
          loadingTask = getDocument({
            ...baseDocumentOptions,
            data: buffer,
          })
          loadedDocument = await loadingTask.promise
        }

        if (cancelled) {
          loadedDocument.destroy()
          return
        }

        const firstPage = await loadedDocument.getPage(1)
        const firstViewport = firstPage.getViewport({ scale: 1 })
        const baseWidth = firstViewport.width || 612
        const aspectRatio = baseWidth > 0
          ? (firstViewport.height || 792) / baseWidth
          : 1.29

        setEstimatedPageMetrics({
          baseWidth,
          aspectRatio,
        })

        setPdfDocument(loadedDocument)
        setPageCount(loadedDocument.numPages)
        onPageCountChange?.(loadedDocument.numPages)
        onCurrentPageChange?.(1)
        setLoadingState({
          status: 'ready',
          message: `${file.name || 'PDF'} is ready. Highlight a word to look it up.`,
        })
      } catch (error) {
        if (!cancelled) {
          setPdfDocument(null)
          setPageCount(0)
          setEstimatedPageMetrics(null)
          onPageCountChange?.(0)
          setLoadingState({
            status: 'error',
            message: getReadablePdfErrorMessage(error),
          })
        }
      }
    }

    loadPdf()

    return () => {
      cancelled = true
      loadingTask?.destroy()
      loadedDocument?.destroy()

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [file, onCurrentPageChange, onPageCountChange, useCompactRendering])

  useEffect(() => {
    if (!singlePageMode || !viewerShellRef.current) {
      return
    }

    viewerShellRef.current.scrollTo({ top: 0, behavior: 'smooth' })
  }, [currentPage, singlePageMode])

  useEffect(() => {
    if (!pdfDocument || loadingState.status !== 'ready' || !viewerShellRef.current || singlePageMode) {
      return undefined
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)

        if (visibleEntries.length === 0) {
          return
        }

        const pageValue = Number.parseInt(visibleEntries[0].target.getAttribute('data-page-number') || '', 10)

        if (Number.isFinite(pageValue)) {
          onCurrentPageChange?.(pageValue)
        }
      },
      {
        root: viewerShellRef.current,
        threshold: [0.5, 0.75],
      }
    )

    const pageNodes = viewerShellRef.current.querySelectorAll('[data-page-number]')
    pageNodes.forEach((node) => observer.observe(node))

    return () => {
      observer.disconnect()
    }
  }, [pdfDocument, loadingState.status, pageCount, scale, onCurrentPageChange, singlePageMode])

  useEffect(() => {
    if (!pdfDocument || loadingState.status !== 'ready') {
      return undefined
    }

    const handleKeyDown = (event) => {
      if (isEditableTarget(event.target)) {
        return
      }

      if (event.ctrlKey && (event.key === '+' || event.key === '=')) {
        event.preventDefault()
        onScaleChange?.((currentScale) => clampScale(currentScale + 0.2))
        return
      }

      if (event.ctrlKey && event.key === '-') {
        event.preventDefault()
        onScaleChange?.((currentScale) => clampScale(currentScale - 0.2))
        return
      }

      if (event.ctrlKey && event.key === '0') {
        event.preventDefault()
        onScaleChange?.(1.5)
        return
      }

      if (event.key === 'PageDown' || event.key === 'ArrowRight') {
        event.preventDefault()
        const nextPage = Math.min(pageCount, (currentPage || 1) + 1)
        onCurrentPageChange?.(nextPage)
        if (!singlePageMode) {
          viewerShellRef.current
            ?.querySelector?.(`[data-page-number="${nextPage}"]`)
            ?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
        }
        return
      }

      if (event.key === 'PageUp' || event.key === 'ArrowLeft') {
        event.preventDefault()
        const previousPage = Math.max(1, (currentPage || 1) - 1)
        onCurrentPageChange?.(previousPage)
        if (!singlePageMode) {
          viewerShellRef.current
            ?.querySelector?.(`[data-page-number="${previousPage}"]`)
            ?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [pdfDocument, loadingState.status, currentPage, pageCount, onCurrentPageChange, onScaleChange, singlePageMode])

  if (!file) {
    return (
      <section className="pdf-viewer-shell pdf-viewer-empty" ref={setViewerRef}>
        <div>
          <h2>Select a local PDF to begin.</h2>
        </div>
      </section>
    )
  }

  return (
    <section className={`pdf-viewer-shell ${singlePageMode ? 'pdf-viewer-shell--single-page' : ''}`} ref={setViewerRef}>
      {loadingState.status !== 'ready' && <div className="pdf-loader">{loadingState.message}</div>}

      {loadingState.status === 'ready' && pdfDocument && (
        <div className={`pdf-pages ${singlePageMode ? 'pdf-pages--single' : ''}`} aria-live="polite">
          {pagesToRender.map((pageNumber) => {
            return (
              <PdfPage
                key={`${pageNumber}-${scale}`}
                pdfDocument={pdfDocument}
                pageNumber={pageNumber}
                scale={scale}
                pixelRatioCap={pixelRatioCap}
                maxCanvasPixels={maxCanvasPixels}
                observerRootRef={viewerShellRef}
                singlePageMode={singlePageMode}
                estimatedPageDimensions={estimatedPageDimensions}
              />
            )
          })}
        </div>
      )}

      {loadingState.status === 'error' && <div className="pdf-error">{loadingState.message}</div>}
    </section>
  )
}

export default forwardRef(PdfViewer)