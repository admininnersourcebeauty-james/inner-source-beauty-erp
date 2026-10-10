import { FULFILLMENT_METHODS } from './backorder.js'
import { staffSalesPersonLabel } from './staffProfiles.js'

const CONFIDENT_SCORE = 0.82
const MAYBE_SCORE = 0.62

const ENGLISH_NUMBERS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
}

const ENGLISH_COMPOUND_TENS = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
}

const KOREAN_NUMBERS = {
  영: 0, 공: 0, 일: 1, 하나: 1, 한: 1, 둘: 2, 두: 2, 셋: 3, 세: 3, 넷: 4, 네: 4, 다섯: 5,
  여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10,
}

const PAYMENT_TERMS = ['COD', 'NET 15', 'NET 30', 'NET 45', 'NET 60']

export const VOICE_LANGUAGE_OPTIONS = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'ko-KR', label: 'Korean' },
]

export const DEFAULT_VOICE_LANGUAGE = 'en-US'

export function isSpeechRecognitionSupported() {
  return typeof window !== 'undefined'
    && !!(window.SpeechRecognition || window.webkitSpeechRecognition)
}

export function createSpeechRecognition(lang = DEFAULT_VOICE_LANGUAGE) {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!Ctor) return null
  const recognition = new Ctor()
  recognition.continuous = true
  recognition.interimResults = true
  recognition.maxAlternatives = 1
  recognition.lang = lang === 'ko-KR' ? 'ko-KR' : 'en-US'
  return recognition
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[·•]/g, ' ')
    .replace(/[^\w\s가-힣%-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeProductText(value) {
  let text = normalizeText(value)
  const compounds = [
    ['twenty two', '22'], ['twenty one', '21'], ['twenty three', '23'], ['twenty four', '24'],
    ['twenty five', '25'], ['twenty six', '26'], ['twenty seven', '27'], ['twenty eight', '28'],
    ['twenty nine', '29'], ['thirty two', '32'], ['thirty three', '33'], ['forty two', '42'],
  ]
  for (const [phrase, digit] of compounds) {
    text = text.replace(new RegExp(`\\b${phrase}\\b`, 'g'), digit)
  }
  return text
    .replace(/\btwenty\b/g, '20')
    .replace(/\bthirty\b/g, '30')
    .replace(/\bforty\b/g, '40')
    .replace(/\bfifty\b/g, '50')
    .replace(/\bsixty\b/g, '60')
    .replace(/\bseventy\b/g, '70')
    .replace(/\beighty\b/g, '80')
    .replace(/\bninety\b/g, '90')
    .replace(/\breturn\b/g, 'return')
    .replace(/(?:^|\s)리턴(?=\s|$)/g, ' return')
    .replace(/\s+/g, ' ')
    .trim()
}

function levenshtein(a, b) {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return dp[m][n]
}

function tokenOverlapScore(a, b) {
  const ta = new Set(normalizeText(a).split(' ').filter(Boolean))
  const tb = new Set(normalizeText(b).split(' ').filter(Boolean))
  if (!ta.size || !tb.size) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  return inter / (ta.size + tb.size - inter)
}

export function scoreMatch(query, candidate) {
  const q = normalizeText(query)
  const c = normalizeText(candidate)
  if (!q || !c) return 0
  if (q === c) return 1
  if (c.includes(q) || q.includes(c)) return 0.93
  const overlap = tokenOverlapScore(q, c)
  const lev = 1 - (levenshtein(q, c) / Math.max(q.length, c.length, 1))
  return Math.max(overlap, lev)
}

function scoreProductMatch(query, item) {
  const labels = [
    item.style,
    item.brand,
    [item.style, item.brand].filter(Boolean).join(' '),
    [item.brand, item.style].filter(Boolean).join(' '),
  ].filter(Boolean)
  const qNorm = normalizeProductText(query)
  let best = 0
  for (const label of labels) {
    best = Math.max(best, scoreMatch(qNorm, normalizeProductText(label)))
  }
  return best
}

function rankMatches(query, candidates, labelFn, scoreFn = scoreMatch) {
  return candidates
    .map(entry => ({
      entry,
      score: scoreFn(query, typeof labelFn === 'function' ? labelFn(entry) : labelFn(entry)),
    }))
    .filter(x => x.score >= MAYBE_SCORE)
    .sort((a, b) => b.score - a.score)
}

function matchStatus(score, matchCount) {
  if (score >= CONFIDENT_SCORE && matchCount === 1) return 'confirmed'
  if (score >= MAYBE_SCORE) return 'needs_confirmation'
  return 'missing'
}

function parseEnglishNumberPhrase(text) {
  const cleaned = normalizeText(text)
  if (!cleaned) return null
  if (/^\d+$/.test(cleaned)) return Number(cleaned)

  const compound = cleaned.match(/^(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-]+(one|two|three|four|five|six|seven|eight|nine)(?:\s|$)/)
  if (compound && ENGLISH_COMPOUND_TENS[compound[1]] != null) {
    return ENGLISH_COMPOUND_TENS[compound[1]] + ENGLISH_NUMBERS[compound[2]]
  }

  for (const [word, value] of Object.entries(KOREAN_NUMBERS)) {
    if (new RegExp(`(?:^|\\s)${word}\\s*개(?:\\s|$)`).test(cleaned)) return value
  }

  for (const [word, value] of Object.entries(ENGLISH_NUMBERS)) {
    if (new RegExp(`\\b${word}\\b`).test(cleaned)) return value
  }

  return parseQuantityToken(cleaned)
}

function parseLeadingQuantity(segment) {
  const trimmed = String(segment || '').trim()
  const compound = trimmed.match(/^(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-]+(one|two|three|four|five|six|seven|eight|nine)\s+(.+)$/i)
  if (compound) {
    const qty = parseEnglishNumberPhrase(`${compound[1]} ${compound[2]}`)
    if (qty != null) return { qty, name: compound[3].trim() }
  }

  const leading = trimmed.match(/^(\d+|[a-z가-힣]+)\s+(.+)$/i)
  if (!leading) return null
  const qty = parseEnglishNumberPhrase(leading[1]) ?? parseQuantityToken(leading[1])
  if (qty == null) return null
  return { qty, name: leading[2].trim() }
}

function parseTrailingQuantity(segment) {
  const trimmed = String(segment || '').trim()
  const compound = trimmed.match(/^(.+?)\s+(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-]+(one|two|three|four|five|six|seven|eight|nine)\s*$/i)
  if (compound) {
    const qty = parseEnglishNumberPhrase(`${compound[2]} ${compound[3]}`)
    if (qty != null) return { qty, name: compound[1].trim() }
  }

  const trailing = trimmed.match(/^(.+?)\s+([a-z가-힣]+)\s*$/i)
  if (!trailing) return null
  const qty = parseEnglishNumberPhrase(trailing[2]) ?? parseQuantityToken(trailing[2])
  if (qty == null) return null
  return { qty, name: trailing[1].trim() }
}

function parseQuantityToken(raw) {
  const token = normalizeText(raw)
  if (!token) return null
  if (/^\d+$/.test(token)) return Number(token)
  if (ENGLISH_NUMBERS[token] != null) return ENGLISH_NUMBERS[token]
  if (KOREAN_NUMBERS[token] != null) return KOREAN_NUMBERS[token]
  return null
}

export function parseSpokenQuantity(text) {
  const cleaned = normalizeText(text)
  if (!cleaned) return null

  if (/^(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-]+(one|two|three|four|five|six|seven|eight|nine)$/.test(cleaned)) {
    return parseEnglishNumberPhrase(cleaned)
  }

  const labeledQty = cleaned.match(/\b(?:qty|quantity)\s+(\d+|[a-z\s-]+?)(?:\s|$)/)
  if (labeledQty) {
    const parsed = parseEnglishNumberPhrase(labeledQty[1])
    if (parsed != null) return parsed
  }

  const unitsQty = cleaned.match(/\b(\d+|[a-z]+)\s+units?\b/)
  if (unitsQty) {
    const parsed = parseEnglishNumberPhrase(unitsQty[1])
    if (parsed != null) return parsed
  }

  const piecesQty = cleaned.match(/\b(\d+|[a-z]+)\s+pieces?\b/)
  if (piecesQty) {
    const parsed = parseEnglishNumberPhrase(piecesQty[1])
    if (parsed != null) return parsed
  }

  const digitMatch = cleaned.match(/(\d+)/)
  if (digitMatch) return Number(digitMatch[1])

  const koreanCounter = cleaned.match(/(\d+)\s*개/)
  if (koreanCounter) return Number(koreanCounter[1])

  for (const [word, value] of Object.entries(KOREAN_NUMBERS)) {
    if (new RegExp(`(?:^|\\s)${word}\\s*개(?:\\s|$)`).test(cleaned)) return value
  }

  for (const [word, value] of Object.entries(ENGLISH_NUMBERS)) {
    if (new RegExp(`\\b${word}\\b`).test(cleaned)) return value
  }

  for (const [word, value] of Object.entries(KOREAN_NUMBERS)) {
    if (new RegExp(`\\b${word}\\b`).test(cleaned)) return value
  }

  return parseEnglishNumberPhrase(cleaned)
}

function splitSegments(text) {
  return String(text || '')
    .split(/[,;]+/)
    .map(s => normalizeText(s.trim()))
    .filter(Boolean)
}

function extractLabeledValue(text, labels) {
  for (const label of labels) {
    const re = new RegExp(`\\b${label}\\b[:\\s]+(.+)$`, 'i')
    const match = text.match(re)
    if (match) return match[1].trim()
  }
  return ''
}

function detectFulfillment(text) {
  const t = normalizeText(text)
  const map = [
    { keys: ['company delivery', 'company deliver', '회사 배송'], value: 'Company Delivery' },
    { keys: ['customer pickup', 'pickup', 'pick up', '고객 픽업'], value: 'Customer Pickup' },
    { keys: ['ups next day'], value: 'UPS Next Day' },
    { keys: ['ups 2nd day', 'ups second day'], value: 'UPS 2nd Day' },
    { keys: ['ups 3 day', 'ups three day'], value: 'UPS 3 Day' },
    { keys: ['ups ground'], value: 'UPS Ground' },
    { keys: ['usps priority'], value: 'USPS Priority' },
    { keys: ['usps ground'], value: 'USPS Ground' },
  ]
  for (const row of map) {
    if (row.keys.some(k => t.includes(k))) return row.value
  }
  for (const method of FULFILLMENT_METHODS) {
    if (t.includes(normalizeText(method))) return method
  }
  return ''
}

function detectPaymentTerms(text) {
  const t = normalizeText(text)
  if (/\bcod\b/.test(t) || t.includes('cash on delivery')) return 'COD'
  if (/\bnet 60\b/.test(t)) return 'NET 60'
  if (/\bnet 45\b/.test(t)) return 'NET 45'
  if (/\bnet 30\b/.test(t)) return 'NET 30'
  if (/\bnet 15\b/.test(t)) return 'NET 15'
  return ''
}

function extractSalesPersonPhrase(text) {
  const patterns = [
    /\b(?:salesperson|sales person|sales rep)\s+(.+?)(?:,|$)/i,
    /\b(?:salesperson|sales person|sales rep)\s+is\s+(.+?)(?:,|$)/i,
  ]
  for (const re of patterns) {
    const match = text.match(re)
    if (match) return match[1].trim()
  }
  return ''
}

function extractProductFromSegment(segment) {
  let name = segment
  let qty = null

  const qtyLabel = segment.match(/^(.+?)\s+(?:qty|quantity)\s+(\d+|[a-z가-힣\s-]+)$/i)
  if (qtyLabel) {
    name = qtyLabel[1].trim()
    qty = parseEnglishNumberPhrase(qtyLabel[2]) ?? parseQuantityToken(qtyLabel[2])
  }

  const unitsPattern = segment.match(/^(.+?)\s+(\d+|[a-z가-힣]+)\s+units?\s*$/i)
  if (!qty && unitsPattern) {
    name = unitsPattern[1].trim()
    qty = parseEnglishNumberPhrase(unitsPattern[2]) ?? parseQuantityToken(unitsPattern[2])
  }

  const piecesPattern = segment.match(/^(.+?)\s+(\d+|[a-z가-힣]+)\s+pieces?\s*$/i)
  if (!qty && piecesPattern) {
    name = piecesPattern[1].trim()
    qty = parseEnglishNumberPhrase(piecesPattern[2]) ?? parseQuantityToken(piecesPattern[2])
  }

  const koreanQtyPattern = segment.match(/^(.+?)\s+(\d+)\s*개\s*$/i)
  if (!qty && koreanQtyPattern) {
    name = koreanQtyPattern[1].trim()
    qty = Number(koreanQtyPattern[2])
  }

  const koreanWordQty = segment.match(/^(.+?)\s+([a-z가-힣]+)\s*개\s*$/i)
  if (!qty && koreanWordQty) {
    name = koreanWordQty[1].trim()
    qty = parseQuantityToken(koreanWordQty[2])
  }

  const leadingQty = parseLeadingQuantity(segment)
  if (leadingQty) {
    name = leadingQty.name
    qty = leadingQty.qty
  }

  if (!qty) {
    const trailingQty = parseTrailingQuantity(segment)
    if (trailingQty) {
      name = trailingQty.name
      qty = trailingQty.qty
    }
  }

  name = name
    .replace(/\b(salesperson|sales person|sales rep)\b.*$/i, '')
    .replace(/\b(company delivery|customer pickup|payment terms|note|memo|zelle|venmo|cash|credit card)\b.*$/i, '')
    .trim()

  return { raw: segment, name, qty }
}

export function splitVoiceSegments(text) {
  return splitSegments(text)
}

export function parseVoiceProductSegments(text) {
  return parseProductSegments(splitSegments(text))
}

function parseProductSegments(segments) {
  const items = []
  const skipSegment = /^(salesperson|sales person|sales rep|company delivery|customer pickup|payment terms|note|memo|zelle|venmo|credit card)\b/i

  for (const segment of segments) {
    if (skipSegment.test(segment)) continue
    if (/^cash\b/i.test(segment)) continue

    const parsed = extractProductFromSegment(segment)
    if (!parsed.name) continue
    if (parsed.qty == null || parsed.qty <= 0) continue

    items.push(parsed)
  }

  return items
}

function customerLabel(c) {
  return c.company || c.name || ''
}

function inventoryLabel(item) {
  return [item.style, item.brand].filter(Boolean).join(' ')
}

function getProductSearchLabels(item) {
  const style = String(item.style || '').trim()
  const brand = String(item.brand || '').trim()
  return [...new Set([
    style,
    brand,
    [style, brand].filter(Boolean).join(' '),
    [brand, style].filter(Boolean).join(' '),
  ].filter(Boolean))]
}

function removeNonProductPhrases(text) {
  return normalizeText(text)
    .replace(/\b(?:salesperson|sales person|sales rep)\b.*?(?=,|$)/gi, ' ')
    .replace(/\b(?:company delivery|customer pickup|payment terms|note|memo|zelle|venmo|credit card|cash on delivery)\b.*?(?=,|$)/gi, ' ')
    .replace(/\b(?:cod|net 15|net 30|net 45|net 60)\b/gi, ' ')
    .replace(/\b(?:ups next day|ups 2nd day|ups 3 day|ups ground|usps priority|usps ground)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function removeCustomerFromText(text, customer) {
  let result = normalizeProductText(text)
  const labels = [customer?.company, customer?.name].filter(Boolean)
  for (const label of labels) {
    const norm = normalizeProductText(label)
    if (!norm) continue
    result = result.replace(new RegExp(escapeRegex(norm), 'gi'), ' ')
    for (const token of norm.split(/\s+/).filter(t => t.length >= 2)) {
      result = result.replace(new RegExp(`\\b${escapeRegex(token)}\\b`, 'gi'), ' ')
    }
  }
  return normalizeText(result)
}

function isQuantityToken(token) {
  if (!token) return false
  if (/^\d+$/.test(token)) return true
  if (ENGLISH_NUMBERS[token] != null) return true
  if (KOREAN_NUMBERS[token] != null) return true
  if (/^\d+개$/.test(token)) return true
  return false
}

function getProductNameTokenSet(productLabel) {
  return new Set(normalizeProductText(productLabel).split(/\s+/).filter(Boolean))
}

function getProductNameNumericValues(productLabel) {
  const values = new Set()
  for (const token of getProductNameTokenSet(productLabel)) {
    if (/^\d+$/.test(token)) values.add(Number(token))
    const parsed = parseQuantityToken(token)
    if (parsed != null) values.add(parsed)
  }
  return values
}

function tokenBelongsToProductName(token, productLabel) {
  const norm = normalizeText(token)
  if (!norm || !productLabel) return false
  return getProductNameTokenSet(productLabel).has(norm)
}

function isExcludedQuantityToken(token, productLabel, position, side) {
  if (!token || !productLabel) return false
  if (tokenBelongsToProductName(token, productLabel)) return true

  const numeric = parseQuantityToken(token) ?? parseEnglishNumberPhrase(token)
  if (numeric == null) return false

  const productNumbers = getProductNameNumericValues(productLabel)
  if (!productNumbers.has(numeric)) return false

  if (side === 'after' && position === 0) return true
  if (side === 'before' && position === -1) return true
  return false
}

function tryParseQuantityAt(tokens, index) {
  if (index < 0 || index >= tokens.length) return null
  if (index > 0) {
    const compound = parseEnglishNumberPhrase(`${tokens[index - 1]} ${tokens[index]}`)
    if (compound != null && ENGLISH_COMPOUND_TENS[tokens[index - 1]] != null) return compound
  }
  if (tokens[index] === '개' && index > 0) {
    const koreanQty = parseQuantityToken(tokens[index - 1])
    if (koreanQty != null && koreanQty > 0) return koreanQty
  }
  const direct = parseQuantityToken(tokens[index]) ?? parseEnglishNumberPhrase(tokens[index])
  if (direct != null && direct > 0) return direct
  if (/^\d+개$/.test(tokens[index])) {
    const koreanQty = parseQuantityToken(tokens[index].replace(/개$/, ''))
    if (koreanQty != null && koreanQty > 0) return koreanQty
  }
  return null
}

function collectQuantityCandidates(regionText, productLabel, side) {
  if (!regionText) return []
  const tokens = regionText.split(/\s+/).filter(Boolean)
  if (!tokens.length) return []

  let scanTokens = tokens
  if (side === 'after') {
    let startIdx = 0
    while (startIdx < tokens.length && isExcludedQuantityToken(tokens[startIdx], productLabel, startIdx, 'after')) {
      startIdx += 1
    }
    scanTokens = tokens.slice(startIdx)
  } else {
    let endIdx = tokens.length - 1
    while (endIdx >= 0 && isExcludedQuantityToken(tokens[endIdx], productLabel, endIdx, 'before')) {
      endIdx -= 1
    }
    scanTokens = tokens.slice(0, endIdx + 1)
  }

  const candidates = []
  if (side === 'after') {
    for (let i = 0; i < Math.min(5, scanTokens.length); i++) {
      if (isExcludedQuantityToken(scanTokens[i], productLabel, i, 'after')) continue
      const qty = tryParseQuantityAt(scanTokens, i)
      if (qty != null) {
        candidates.push({ qty, distance: i + 1 })
        break
      }
    }
    const koreanMatch = regionText.match(/^(\d+|[a-z가-힣]+)\s*개\b/)
    if (koreanMatch) {
      const token = koreanMatch[1]
      if (!isExcludedQuantityToken(token, productLabel, 0, 'after')) {
        const qty = parseQuantityToken(token) ?? parseEnglishNumberPhrase(token)
        if (qty != null && qty > 0) candidates.push({ qty, distance: 0.5 })
      }
    }
  } else {
    for (let i = scanTokens.length - 1; i >= Math.max(0, scanTokens.length - 5); i--) {
      if (isExcludedQuantityToken(scanTokens[i], productLabel, i, 'before')) continue
      const qty = tryParseQuantityAt(scanTokens, i)
      if (qty != null) {
        candidates.push({ qty, distance: scanTokens.length - i })
        break
      }
    }
    const koreanMatch = regionText.match(/(\d+|[a-z가-힣]+)\s*개\s*$/)
    if (koreanMatch) {
      const token = koreanMatch[1]
      if (!isExcludedQuantityToken(token, productLabel, -1, 'before')) {
        const qty = parseQuantityToken(token) ?? parseEnglishNumberPhrase(token)
        if (qty != null && qty > 0) candidates.push({ qty, distance: 0.5 })
      }
    }
  }

  return candidates
}

function findNearestQuantity(text, matchStart, matchEnd, productLabel = '') {
  const before = text.slice(0, matchStart).trim()
  const after = text.slice(matchEnd).trim()
  const candidates = [
    ...collectQuantityCandidates(before, productLabel, 'before'),
    ...collectQuantityCandidates(after, productLabel, 'after'),
  ]
  if (!candidates.length) return null
  candidates.sort((a, b) => a.distance - b.distance)
  return candidates[0].qty
}

function resolveProductQuantity(sourceText, inventoryEntry, fallbackQty = null) {
  if (!sourceText) return fallbackQty
  const text = normalizeProductText(sourceText)
  if (!text) return fallbackQty

  const labels = inventoryEntry
    ? getProductSearchLabels(inventoryEntry)
    : [sourceText]

  for (const label of labels) {
    const labelNorm = normalizeProductText(label)
    if (!labelNorm) continue
    let idx = 0
    while ((idx = text.indexOf(labelNorm, idx)) !== -1) {
      const qty = findNearestQuantity(text, idx, idx + labelNorm.length, labelNorm)
      if (qty != null && qty > 0) return qty
      idx += 1
    }
  }

  return fallbackQty != null && fallbackQty > 0 ? fallbackQty : null
}

function rangesOverlap(a, b) {
  return a.start < b.end && a.end > b.start
}

function findExactProductOccurrences(text, inventory) {
  const occurrences = []
  for (const item of inventory) {
    for (const label of getProductSearchLabels(item)) {
      const labelNorm = normalizeProductText(label)
      if (!labelNorm || labelNorm.length < 2) continue
      let idx = 0
      while ((idx = text.indexOf(labelNorm, idx)) !== -1) {
        occurrences.push({
          item,
          label: labelNorm,
          start: idx,
          end: idx + labelNorm.length,
          length: labelNorm.length,
        })
        idx += 1
      }
    }
  }
  return occurrences.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start
    return b.length - a.length
  })
}

function findFuzzyProductWindows(text, inventory) {
  const tokens = text.split(/\s+/).filter(Boolean)
  const windows = []
  for (let len = Math.min(8, tokens.length); len >= 1; len--) {
    for (let i = 0; i <= tokens.length - len; i++) {
      const chunk = tokens.slice(i, i + len)
      if (chunk.every(isQuantityToken)) continue
      const window = chunk.join(' ')
      if (window.length < 2) continue
      const start = tokens.slice(0, i).join(' ').length + (i > 0 ? 1 : 0)
      const end = start + window.length
      const best = inventory
        .map(entry => ({ entry, score: scoreProductMatch(window, entry) }))
        .sort((a, b) => b.score - a.score)[0]
      if (best && best.score >= MAYBE_SCORE) {
        windows.push({
          item: best.entry,
          label: window,
          start,
          end,
          length: window.length,
          score: best.score,
        })
      }
    }
  }
  return windows.sort((a, b) => b.score - a.score || b.length - a.length)
}

function stripLeadingQuantityTokens(text) {
  const tokens = text.split(/\s+/).filter(Boolean)
  while (tokens.length) {
    if (tokens.length >= 2) {
      const compound = parseEnglishNumberPhrase(`${tokens[0]} ${tokens[1]}`)
      if (compound != null && ENGLISH_COMPOUND_TENS[tokens[0]] != null) {
        tokens.splice(0, 2)
        continue
      }
    }
    if (isQuantityToken(tokens[0])) {
      tokens.shift()
      continue
    }
    break
  }
  return tokens.join(' ').trim()
}

function scanTranscriptForProducts(transcript, inventory, customerMatch) {
  let text = normalizeProductText(transcript)
  text = removeNonProductPhrases(text)
  if (customerMatch) text = removeCustomerFromText(text, customerMatch)
  text = normalizeProductText(text)
  if (!text) return []

  const found = []
  const usedRanges = []

  for (const occ of findExactProductOccurrences(text, inventory)) {
    if (usedRanges.some(r => rangesOverlap(r, occ))) continue
    const qty = findNearestQuantity(text, occ.start, occ.end, occ.label)
    found.push({
      raw: text.slice(Math.max(0, occ.start - 24), Math.min(text.length, occ.end + 24)).trim(),
      name: occ.label,
      qty,
      inventoryId: occ.item.id,
    })
    usedRanges.push({ start: occ.start, end: occ.end })
  }

  if (!found.length) {
    for (const occ of findFuzzyProductWindows(text, inventory)) {
      if (usedRanges.some(r => rangesOverlap(r, occ))) continue
      const matchedLabel = normalizeProductText(inventoryLabel(occ.item))
      const qty = findNearestQuantity(text, occ.start, occ.end, matchedLabel)
      if (qty == null || qty <= 0) continue
      found.push({
        raw: occ.label,
        name: matchedLabel || occ.label,
        qty,
        inventoryId: occ.item.id,
      })
      usedRanges.push({ start: occ.start, end: occ.end })
    }
  }

  if (!found.length && text.trim()) {
    const name = stripLeadingQuantityTokens(text)
    const guessedItem = inventory
      .map(entry => ({ entry, score: scoreProductMatch(name || text, entry) }))
      .sort((a, b) => b.score - a.score)[0]?.entry
    const qty = guessedItem
      ? resolveProductQuantity(text, guessedItem, null)
      : null
    if (name || qty != null) {
      found.push({
        raw: text,
        name: name || text,
        qty,
        inventoryId: guessedItem?.id ?? null,
      })
    }
  }

  return found
}

function mergeProductCandidates(scanned, segmented) {
  const byKey = new Map()
  const consider = row => {
    const key = row.inventoryId
      ? String(row.inventoryId)
      : normalizeProductText(row.name || row.raw || '')
    if (!key) return
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, row)
      return
    }
    const existingQty = existing.qty != null && existing.qty > 0 ? existing.qty : null
    const nextQty = row.qty != null && row.qty > 0 ? row.qty : null
    if (!existingQty && nextQty) byKey.set(key, row)
  }
  for (const row of scanned) consider(row)
  for (const row of segmented) consider({ raw: row.raw, name: row.name, qty: row.qty, inventoryId: null })
  return [...byKey.values()]
}

function buildItemResult(parsedProduct, inventory) {
  const name = parsedProduct.name || parsedProduct.raw || ''
  const allScored = inventory
    .map(entry => ({ entry, score: scoreProductMatch(name, entry) }))
    .sort((a, b) => b.score - a.score)

  const nameNorm = normalizeProductText(name)
  for (const row of allScored) {
    for (const label of getProductSearchLabels(row.entry)) {
      const labelNorm = normalizeProductText(label)
      if (!labelNorm) continue
      if (labelNorm === nameNorm) row.score = Math.max(row.score, 0.98)
      else if (nameNorm.includes(labelNorm) || labelNorm.includes(nameNorm)) row.score = Math.max(row.score, 0.92)
    }
  }
  allScored.sort((a, b) => b.score - a.score)

  const top = allScored[0]
  const confident = allScored.filter(m => m.score >= CONFIDENT_SCORE)
  const matchedEntry = parsedProduct.inventoryId
    ? inventory.find(item => String(item.id) === String(parsedProduct.inventoryId)) || top?.entry
    : top?.entry
  const resolvedQty = matchedEntry
    ? resolveProductQuantity(parsedProduct.raw || parsedProduct.name || name, matchedEntry, parsedProduct.qty)
    : parsedProduct.qty
  const qty = resolvedQty != null && resolvedQty > 0 ? resolvedQty : null

  return {
    phrase: parsedProduct.raw || name,
    name,
    qty,
    qtyStatus: qty ? 'confirmed' : 'missing',
    status: top && top.score >= CONFIDENT_SCORE && confident.length === 1
      ? 'confirmed'
      : top && top.score >= MAYBE_SCORE
        ? 'needs_confirmation'
        : 'missing',
    score: top?.score || 0,
    match: top && top.score >= CONFIDENT_SCORE && confident.length === 1 ? top.entry : null,
    suggestions: allScored.slice(0, 4).map(x => ({
      id: x.entry.id,
      label: inventoryLabel(x.entry),
      score: x.score,
    })),
  }
}

function findCustomerInTranscript(text, customers) {
  const textNorm = normalizeText(text)
  return customers
    .map(entry => {
      const label = customerLabel(entry)
      const labelNorm = normalizeText(label)
      if (!labelNorm) return { entry, score: 0, phrase: '' }

      let score = scoreMatch(text, label)
      if (textNorm.includes(labelNorm)) score = Math.max(score, 0.96)

      for (const token of labelNorm.split(/\s+/).filter(Boolean)) {
        if (token.length >= 2 && new RegExp(`\\b${escapeRegex(token)}\\b`).test(textNorm)) {
          score = Math.max(score, 0.9)
        }
      }
      return { entry, score, phrase: label }
    })
    .filter(x => x.score >= MAYBE_SCORE)
    .sort((a, b) => b.score - a.score)
}

export function parseVoiceOrderTranscript(transcript, { customers = [], inventory = [], staffUsers = [] } = {}) {
  const text = String(transcript || '').trim()
  const segments = splitSegments(text)
  const salesPersonPhrase = extractSalesPersonPhrase(text)
  const fulfillmentMethod = detectFulfillment(text)
  const paymentTerms = detectPaymentTerms(text)
  const notePhrase = extractLabeledValue(text, ['note', 'memo']) || ''

  const customerMatches = findCustomerInTranscript(text, customers)
  const topCustomer = customerMatches[0]
  const matchedCustomer = topCustomer?.score >= MAYBE_SCORE ? topCustomer.entry : null
  const customerPhrase = topCustomer?.phrase
    || segments[0]?.replace(/\b(salesperson|sales person|sales rep)\b.*$/i, '').trim()
    || ''

  const customer = {
    phrase: customerPhrase,
    status: customerPhrase
      ? matchStatus(topCustomer?.score || 0, customerMatches.length)
      : 'missing',
    score: topCustomer?.score || 0,
    match: topCustomer?.score >= CONFIDENT_SCORE && customerMatches.length === 1 ? topCustomer.entry : null,
    suggestions: customerMatches.slice(0, 4).map(x => ({ id: x.entry.id, label: customerLabel(x.entry), score: x.score })),
  }

  const segmentedProducts = parseProductSegments(segments)
  const scannedProducts = scanTranscriptForProducts(text, inventory, matchedCustomer)
  const mergedProducts = mergeProductCandidates(scannedProducts, segmentedProducts)
  const items = mergedProducts.map(parsed => buildItemResult(parsed, inventory))

  const staffMatches = salesPersonPhrase
    ? rankMatches(salesPersonPhrase, staffUsers.filter(u => u), staffSalesPersonLabel)
    : []
  const topStaff = staffMatches[0]
  const salesPerson = {
    phrase: salesPersonPhrase,
    status: salesPersonPhrase
      ? matchStatus(topStaff?.score || 0, staffMatches.length)
      : 'missing',
    score: topStaff?.score || 0,
    match: topStaff?.score >= CONFIDENT_SCORE && staffMatches.length === 1 ? topStaff.entry : null,
    suggestions: staffMatches.slice(0, 4).map(x => ({
      id: x.entry.id,
      label: staffSalesPersonLabel(x.entry),
      score: x.score,
    })),
  }

  const fulfillment = {
    phrase: fulfillmentMethod,
    status: fulfillmentMethod ? 'confirmed' : 'missing',
    value: fulfillmentMethod || '',
  }

  const terms = {
    phrase: paymentTerms,
    status: paymentTerms ? 'confirmed' : 'missing',
    value: paymentTerms,
    suggestions: PAYMENT_TERMS,
  }

  const note = {
    phrase: notePhrase,
    status: notePhrase ? 'confirmed' : 'missing',
    value: notePhrase,
  }

  return {
    transcript: text,
    customer,
    items,
    salesPerson,
    fulfillment,
    paymentTerms: terms,
    note,
  }
}

export const DEFAULT_VOICE_FULFILLMENT_METHOD = 'Company Delivery'

export function buildVoiceOrderFormPatch(parseResult, selections = {}, defaults = {}) {
  const {
    defaultSalesPersonId = null,
    defaultFulfillmentMethod = DEFAULT_VOICE_FULFILLMENT_METHOD,
  } = defaults

  const customerId = selections.customerId
    ?? (parseResult.customer.status === 'confirmed' ? parseResult.customer.match?.id : null)

  const salesPersonWasSpoken = !!parseResult.salesPerson?.phrase
  let salesPersonId = selections.salesPersonId ?? null
  if (!salesPersonId && parseResult.salesPerson.status === 'confirmed') {
    salesPersonId = parseResult.salesPerson.match?.id ?? null
  }
  if (!salesPersonId && !salesPersonWasSpoken) {
    salesPersonId = defaultSalesPersonId ?? null
  }

  const fulfillmentWasSpoken = !!parseResult.fulfillment?.value
  let shippingMethod = selections.shippingMethod || ''
  if (!shippingMethod && parseResult.fulfillment.status === 'confirmed') {
    shippingMethod = parseResult.fulfillment.value || ''
  }
  if (!shippingMethod && !fulfillmentWasSpoken) {
    shippingMethod = defaultFulfillmentMethod || DEFAULT_VOICE_FULFILLMENT_METHOD
  }

  const paymentTerms = selections.paymentTerms
    ?? (parseResult.paymentTerms.status === 'confirmed' ? parseResult.paymentTerms.value : '')
  const customerNote = selections.customerNote ?? (parseResult.note.status === 'confirmed' ? parseResult.note.value : '')
  const lines = (parseResult.items || []).map((item, idx) => {
    const selectedId = selections.items?.[idx]?.inventoryId
    const inventoryId = selectedId ?? (item.status === 'confirmed' ? item.match?.id : null)
    const qty = selections.items?.[idx]?.qty ?? item.qty
    return {
      inventoryId,
      qty: qty != null && qty > 0 ? qty : null,
      status: item.status,
      qtyStatus: item.qtyStatus,
      label: item.name,
    }
  })

  return {
    customerId,
    salesPersonId,
    shippingMethod,
    paymentTerms,
    customerNote,
    lines,
    salesPersonIsDefault: !selections.salesPersonId
      && parseResult.salesPerson.status !== 'confirmed'
      && !salesPersonWasSpoken
      && !!defaultSalesPersonId
      && String(salesPersonId || '') === String(defaultSalesPersonId),
    fulfillmentIsDefault: !selections.shippingMethod
      && parseResult.fulfillment.status !== 'confirmed'
      && !fulfillmentWasSpoken
      && !!defaultFulfillmentMethod
      && shippingMethod === defaultFulfillmentMethod,
  }
}

export function voiceOrderReviewReady(parseResult, selections = {}, defaults = {}) {
  const patch = buildVoiceOrderFormPatch(parseResult, selections, defaults)
  if (!patch.customerId) return false
  if (!patch.lines.length) return false
  if (patch.lines.some(line => !line.inventoryId || !line.qty)) return false
  return true
}
