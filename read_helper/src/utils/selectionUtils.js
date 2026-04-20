const WORD_MATCH_PATTERN = /[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g
const WORD_CHAR_PATTERN = /[A-Za-z0-9'-]/

function normalizeSelectionText(text) {
  return text
    .replace(/\u00AD|\u200B|\u200C|\u200D|\uFEFF/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenizeWords(text) {
  return normalizeSelectionText(text).match(WORD_MATCH_PATTERN) ?? []
}

function cleanWord(value) {
  return value
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/[^A-Za-z0-9]+$/, '')
}

function expandWordAtOffset(text, originalOffset) {
  if (!text) {
    return ''
  }

  let offset = Math.max(0, Math.min(originalOffset, text.length))

  if (offset >= text.length && text.length > 0) {
    offset = text.length - 1
  }

  if (!WORD_CHAR_PATTERN.test(text[offset] ?? '')) {
    if (offset > 0 && WORD_CHAR_PATTERN.test(text[offset - 1])) {
      offset -= 1
    } else {
      return ''
    }
  }

  let start = offset
  let end = offset + 1

  while (start > 0 && WORD_CHAR_PATTERN.test(text[start - 1])) {
    start -= 1
  }

  while (end < text.length && WORD_CHAR_PATTERN.test(text[end])) {
    end += 1
  }

  return cleanWord(text.slice(start, end))
}

function getCaretPositionFromPoint(x, y) {
  if (typeof document.caretPositionFromPoint === 'function') {
    const position = document.caretPositionFromPoint(x, y)

    if (position) {
      return {
        node: position.offsetNode,
        offset: position.offset,
      }
    }
  }

  if (typeof document.caretRangeFromPoint === 'function') {
    const range = document.caretRangeFromPoint(x, y)

    if (range) {
      return {
        node: range.startContainer,
        offset: range.startOffset,
      }
    }
  }

  return null
}

function getWordAtPointer(mouseEvent, containerElement) {
  const caret = getCaretPositionFromPoint(mouseEvent.clientX, mouseEvent.clientY)

  if (!caret?.node || !containerElement.contains(caret.node)) {
    return ''
  }

  if (caret.node.nodeType === Node.TEXT_NODE) {
    return expandWordAtOffset(caret.node.textContent ?? '', caret.offset)
  }

  if (caret.node.nodeType === Node.ELEMENT_NODE) {
    const child = caret.node.childNodes[caret.offset] ?? caret.node.childNodes[caret.offset - 1]

    if (child?.nodeType === Node.TEXT_NODE) {
      return expandWordAtOffset(child.textContent ?? '', 0)
    }
  }

  return ''
}

function getWordNearSelectionFocus(selection, containerElement) {
  const { focusNode, focusOffset } = selection

  if (!focusNode || !containerElement.contains(focusNode) || focusNode.nodeType !== Node.TEXT_NODE) {
    return ''
  }

  return expandWordAtOffset(focusNode.textContent ?? '', focusOffset)
}

function getValidRange(selection, containerElement) {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null
  }

  const range = selection.getRangeAt(0)

  if (!containerElement.contains(range.commonAncestorContainer)) {
    return null
  }

  return range
}

function resolveSelectedWord({ selection, mouseEvent, containerElement, selectedText, tokens }) {
  if (tokens.length === 1) {
    return tokens[0]
  }

  const pointerWord = cleanWord(getWordAtPointer(mouseEvent, containerElement))

  if (pointerWord) {
    const matchingToken = tokens.find((token) => token.toLowerCase() === pointerWord.toLowerCase())
    return matchingToken || pointerWord
  }

  const focusedWord = cleanWord(getWordNearSelectionFocus(selection, containerElement))

  if (focusedWord) {
    const matchingToken = tokens.find((token) => token.toLowerCase() === focusedWord.toLowerCase())
    return matchingToken || focusedWord
  }

  return tokens[0] ?? cleanWord(selectedText)
}

export function getSelectedWord({ selection, mouseEvent, containerElement }) {
  const range = getValidRange(selection, containerElement)

  if (!range) {
    return ''
  }

  const selectedText = normalizeSelectionText(selection.toString())

  if (!selectedText) {
    return ''
  }

  const tokens = tokenizeWords(selectedText)

  return resolveSelectedWord({
    selection,
    mouseEvent,
    containerElement,
    selectedText,
    tokens,
  })
}

export function getSelectionContext({ selection, mouseEvent, containerElement }) {
  const range = getValidRange(selection, containerElement)

  if (!range) {
    return null
  }

  const selectedText = normalizeSelectionText(selection.toString())

  if (!selectedText) {
    return null
  }

  const tokens = tokenizeWords(selectedText)

  if (tokens.length <= 1) {
    const word = resolveSelectedWord({
      selection,
      mouseEvent,
      containerElement,
      selectedText,
      tokens,
    })

    if (!word) {
      return null
    }

    return {
      type: 'word',
      text: word,
      tokenCount: 1,
    }
  }

  return {
    type: 'phrase',
    text: selectedText,
    tokenCount: tokens.length,
  }
}
