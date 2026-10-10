import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  buildVoiceOrderFormPatch,
  createSpeechRecognition,
  DEFAULT_VOICE_FULFILLMENT_METHOD,
  DEFAULT_VOICE_LANGUAGE,
  isSpeechRecognitionSupported,
  parseVoiceOrderTranscript,
  voiceOrderReviewReady,
  VOICE_LANGUAGE_OPTIONS,
} from './voiceOrder.js'
import { FULFILLMENT_METHODS } from './backorder.js'
import { staffSalesPersonLabel } from './staffProfiles.js'

function StatusIcon({ status }) {
  if (status === 'confirmed') return <span className="voice-order-status voice-order-status-ok" aria-label="Confirmed">✓</span>
  if (status === 'needs_confirmation') return <span className="voice-order-status voice-order-status-warn" aria-label="Needs confirmation">⚠</span>
  return <span className="voice-order-status voice-order-status-missing" aria-label="Missing">⚠</span>
}

function SuggestionButtons({ suggestions, selectedId, onSelect, getKey = x => x.id, getLabel = x => x.label }) {
  if (!suggestions?.length) return null
  return (
    <div className="voice-order-suggestions">
      <p className="voice-order-suggest-label">Did you mean?</p>
      <div className="voice-order-suggest-buttons">
        {suggestions.map(item => (
          <button
            key={getKey(item)}
            type="button"
            className={`soft voice-order-suggest-btn${String(selectedId) === String(getKey(item)) ? ' active' : ''}`}
            onClick={() => onSelect(getKey(item))}
          >
            {getLabel(item)}
          </button>
        ))}
      </div>
    </div>
  )
}

export function VoiceOrderPanel({
  customers,
  inventory,
  staffUsers,
  currentUserId = '',
  defaultFulfillmentMethod = DEFAULT_VOICE_FULFILLMENT_METHOD,
  disabled = false,
  onApplyToForm,
}) {
  const recognitionRef = useRef(null)
  const transcriptPartsRef = useRef([])
  const cancelledRef = useRef(false)
  const [listening, setListening] = useState(false)
  const [interimTranscript, setInterimTranscript] = useState('')
  const [transcript, setTranscript] = useState('')
  const [parseResult, setParseResult] = useState(null)
  const [selections, setSelections] = useState({ items: {} })
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [voiceLanguage, setVoiceLanguage] = useState(DEFAULT_VOICE_LANGUAGE)

  const supported = useMemo(() => isSpeechRecognitionSupported(), [])
  const selectedLanguageLabel = VOICE_LANGUAGE_OPTIONS.find(o => o.value === voiceLanguage)?.label || 'English (US)'
  const defaultSalesPerson = useMemo(
    () => staffUsers.find(u => String(u.id) === String(currentUserId)) || null,
    [staffUsers, currentUserId],
  )
  const voiceDefaults = useMemo(() => ({
    defaultSalesPersonId: defaultSalesPerson?.id ?? null,
    defaultFulfillmentMethod: defaultFulfillmentMethod || DEFAULT_VOICE_FULFILLMENT_METHOD,
  }), [defaultSalesPerson, defaultFulfillmentMethod])

  useEffect(() => () => {
    try {
      recognitionRef.current?.stop?.()
    } catch {
      // ignore cleanup errors
    }
  }, [])

  function resetVoiceSession() {
    cancelledRef.current = true
    setListening(false)
    setInterimTranscript('')
    setTranscript('')
    setParseResult(null)
    setSelections({ items: {} })
    setError('')
    transcriptPartsRef.current = []
    try {
      recognitionRef.current?.stop?.()
    } catch {
      // ignore
    }
    recognitionRef.current = null
  }

  function finishListening() {
    setListening(false)
    const combined = [...transcriptPartsRef.current, interimTranscript].filter(Boolean).join(' ').trim()
    setInterimTranscript('')
    if (!combined) {
      setError('No speech was detected. Please try again and speak clearly near the microphone.')
      setExpanded(true)
      return
    }
    setTranscript(combined)
    const parsed = parseVoiceOrderTranscript(combined, { customers, inventory, staffUsers })
    setParseResult(parsed)
    setExpanded(true)
    setError('')
  }

  function startListening() {
    if (disabled) return
    if (!supported) {
      setError('Voice recognition is not supported in this browser. Try Chrome, Edge, or Safari on a device with microphone access.')
      setExpanded(true)
      return
    }

    cancelledRef.current = false
    try {
      recognitionRef.current?.stop?.()
    } catch {
      // ignore
    }
    recognitionRef.current = null
    setInterimTranscript('')
    setTranscript('')
    setParseResult(null)
    setSelections({ items: {} })
    setError('')
    transcriptPartsRef.current = []
    setExpanded(true)

    const recognition = createSpeechRecognition(voiceLanguage)
    if (!recognition) {
      setError('Voice recognition could not be started in this browser.')
      return
    }

    recognitionRef.current = recognition
    transcriptPartsRef.current = []
    setListening(true)
    setError('')

    recognition.onresult = event => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const piece = event.results[i][0]?.transcript || ''
        if (event.results[i].isFinal) {
          transcriptPartsRef.current.push(piece.trim())
        } else {
          interim += piece
        }
      }
      setInterimTranscript(interim.trim())
    }

    recognition.onerror = event => {
      const code = event.error || 'unknown'
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        setError('Microphone permission was denied. Allow microphone access in your browser settings, then try again.')
      } else if (code === 'no-speech') {
        setError('No speech was detected. Tap Try Again and speak your order clearly.')
      } else if (code !== 'aborted') {
        setError(`Voice recognition error: ${code}. Please try again.`)
      }
      setListening(false)
    }

    recognition.onend = () => {
      if (cancelledRef.current) {
        setListening(false)
        return
      }
      finishListening()
    }

    try {
      recognition.start()
    } catch {
      setError('Unable to start the microphone. Another app may be using it, or this browser may block speech recognition.')
      setListening(false)
    }
  }

  function stopListening() {
    try {
      recognitionRef.current?.stop?.()
    } catch {
      finishListening()
    }
  }

  function updateItemSelection(idx, patch) {
    setSelections(prev => ({
      ...prev,
      items: {
        ...prev.items,
        [idx]: { ...(prev.items?.[idx] || {}), ...patch },
      },
    }))
  }

  function handleApply() {
    if (!parseResult) return
    const patch = buildVoiceOrderFormPatch(parseResult, selections, voiceDefaults)
    if (!patch.customerId) {
      setError('Please confirm the customer before applying to the order form.')
      return
    }
    if (!patch.lines.length || patch.lines.some(line => !line.inventoryId)) {
      setError('Please confirm every product before applying to the order form.')
      return
    }
    if (patch.lines.some(line => !line.qty)) {
      setError('Every product needs a quantity before applying to the order form.')
      return
    }
    onApplyToForm?.(patch)
    setError('')
  }

  const liveTranscript = [transcriptPartsRef.current.join(' '), interimTranscript].filter(Boolean).join(' ').trim()
  const canApply = parseResult && voiceOrderReviewReady(parseResult, selections, voiceDefaults)
  const reviewPatch = parseResult ? buildVoiceOrderFormPatch(parseResult, selections, voiceDefaults) : null
  const resolvedSalesPerson = reviewPatch?.salesPersonId
    ? staffUsers.find(u => String(u.id) === String(reviewPatch.salesPersonId))
    : null
  const resolvedSalesPersonLabel = resolvedSalesPerson
    ? staffSalesPersonLabel(resolvedSalesPerson)
    : (parseResult?.salesPerson.match?.full_name || parseResult?.salesPerson.phrase || '')
  const resolvedFulfillment = reviewPatch?.shippingMethod || ''

  return (
    <div className="voice-order-panel">
      <div className="voice-order-launch">
        <label className="voice-order-language-field">
          Voice Language
          <select
            className="voice-order-language-select"
            value={voiceLanguage}
            onChange={e => setVoiceLanguage(e.target.value)}
            disabled={disabled || listening}
          >
            {VOICE_LANGUAGE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="voice-order-mic-btn"
          onClick={listening ? stopListening : startListening}
          disabled={disabled}
          aria-pressed={listening}
        >
          🎤 {listening ? 'Listening… Tap to Stop' : 'Voice Order'}
        </button>
        {!supported && !disabled && (
          <p className="voice-order-hint">Voice recognition works best in Chrome, Edge, and Safari.</p>
        )}
        {disabled && (
          <p className="voice-order-hint">Voice Order is available when creating a new order.</p>
        )}
      </div>

      {(expanded || listening || parseResult || error) && (
        <div className="voice-order-review">
          {listening && (
            <div className="voice-order-listening">
              <p className="voice-order-listening-title">Listening ({selectedLanguageLabel})…</p>
              <p className="voice-order-live-text">{liveTranscript || 'Speak your order now.'}</p>
              <div className="voice-order-listening-actions">
                <button type="button" className="soft" onClick={stopListening}>Stop</button>
                <button type="button" className="soft" onClick={resetVoiceSession}>Cancel</button>
              </div>
            </div>
          )}

          {error && <p className="field-error voice-order-error" role="alert">{error}</p>}

          {transcript && !listening && (
            <>
              <div className="voice-order-heard">
                <p className="voice-order-heard-label">You said:</p>
                <p className="voice-order-heard-text">{transcript}</p>
                <button type="button" className="soft voice-order-try-again" onClick={startListening} disabled={disabled}>
                  🎤 Try Again
                </button>
              </div>

              {parseResult && (
                <div className="voice-order-review-body">
                  <h3 className="voice-order-review-title">Voice Order Review</h3>
                  <p className="voice-order-review-note">Review the recognized details, confirm any uncertain matches, then apply to the order form. You must still press Create Invoice manually.</p>

                  <div className="voice-order-review-row">
                    <div className="voice-order-review-label">Customer</div>
                    <div className="voice-order-review-value">
                      <StatusIcon status={selections.customerId || parseResult.customer.match ? 'confirmed' : parseResult.customer.status} />
                      <span>{selections.customerId
                        ? (customers.find(c => String(c.id) === String(selections.customerId))?.company
                          || customers.find(c => String(c.id) === String(selections.customerId))?.name
                          || 'Selected customer')
                        : (parseResult.customer.match
                          ? (parseResult.customer.match.company || parseResult.customer.match.name)
                          : (parseResult.customer.phrase || 'Not recognized'))}</span>
                    </div>
                    {parseResult.customer.status !== 'confirmed' && !selections.customerId && (
                      <SuggestionButtons
                        suggestions={parseResult.customer.suggestions}
                        selectedId={selections.customerId}
                        onSelect={id => setSelections(prev => ({ ...prev, customerId: id }))}
                      />
                    )}
                    {!parseResult.customer.phrase && <p className="voice-order-warning">⚠ Customer not detected in speech.</p>}
                    {parseResult.customer.phrase && parseResult.customer.status !== 'confirmed' && !selections.customerId && (
                      <p className="voice-order-warning">⚠ Customer needs confirmation.</p>
                    )}
                  </div>

                  <div className="voice-order-review-items">
                    <div className="voice-order-review-label">Items</div>
                    {parseResult.items.length === 0 && (
                      <p className="voice-order-warning">⚠ No products were recognized.</p>
                    )}
                    {parseResult.items.map((item, idx) => {
                      const selectedId = selections.items?.[idx]?.inventoryId
                        ?? (item.status === 'confirmed' ? item.match?.id : null)
                      const selectedItem = inventory.find(i => String(i.id) === String(selectedId))
                      const qty = selections.items?.[idx]?.qty ?? item.qty
                      const itemStatus = selectedId && qty ? 'confirmed' : (item.status === 'confirmed' && item.qty ? 'confirmed' : 'needs_confirmation')
                      return (
                        <div key={`${item.phrase}-${idx}`} className="voice-order-item-row">
                          <div className="voice-order-review-value">
                            <StatusIcon status={itemStatus} />
                            <span>{selectedItem ? (selectedItem.style || selectedItem.brand) : item.name}</span>
                            <span className="voice-order-item-qty">Qty {qty ?? '—'}</span>
                          </div>
                          {(!selectedId || item.status !== 'confirmed') && (
                            <SuggestionButtons
                              suggestions={item.suggestions}
                              selectedId={selectedId}
                              onSelect={id => updateItemSelection(idx, { inventoryId: id })}
                            />
                          )}
                          {item.qtyStatus !== 'confirmed' && (
                            <label className="voice-order-qty-input">
                              Quantity
                              <input
                                type="number"
                                min="1"
                                value={selections.items?.[idx]?.qty ?? item.qty ?? ''}
                                onChange={e => updateItemSelection(idx, { qty: Number(e.target.value) || '' })}
                              />
                            </label>
                          )}
                          {!selectedId && <p className="voice-order-warning">⚠ Product not confidently matched.</p>}
                          {selectedId && !qty && <p className="voice-order-warning">⚠ Quantity not understood.</p>}
                        </div>
                      )
                    })}
                  </div>

                  <div className="voice-order-review-row">
                    <div className="voice-order-review-label">Sales Person</div>
                    <div className="voice-order-review-value">
                      <StatusIcon status={resolvedSalesPersonLabel ? 'confirmed' : parseResult.salesPerson.status} />
                      <span>
                        {resolvedSalesPersonLabel || 'Not available'}
                        {reviewPatch?.salesPersonIsDefault && (
                          <span className="voice-order-default-tag"> (Default)</span>
                        )}
                      </span>
                    </div>
                    {parseResult.salesPerson.status !== 'confirmed' && !selections.salesPersonId && parseResult.salesPerson.suggestions.length > 0 && (
                      <SuggestionButtons
                        suggestions={parseResult.salesPerson.suggestions}
                        selectedId={selections.salesPersonId || reviewPatch?.salesPersonId}
                        onSelect={id => setSelections(prev => ({ ...prev, salesPersonId: id }))}
                      />
                    )}
                  </div>

                  <div className="voice-order-review-row">
                    <div className="voice-order-review-label">Fulfillment</div>
                    <div className="voice-order-review-value">
                      <StatusIcon status={resolvedFulfillment ? 'confirmed' : 'missing'} />
                      <span>
                        {resolvedFulfillment || 'Not selected'}
                        {reviewPatch?.fulfillmentIsDefault && (
                          <span className="voice-order-default-tag"> (Default)</span>
                        )}
                      </span>
                    </div>
                    <select
                      className="voice-order-fulfillment-select"
                      value={selections.shippingMethod || resolvedFulfillment || ''}
                      onChange={e => setSelections(prev => ({ ...prev, shippingMethod: e.target.value }))}
                    >
                      <option value="">Select Fulfillment Method</option>
                      {FULFILLMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>

                  {(parseResult.paymentTerms.value || parseResult.paymentTerms.phrase) && (
                    <div className="voice-order-review-row">
                      <div className="voice-order-review-label">Payment Terms</div>
                      <div className="voice-order-review-value">
                        <StatusIcon status={selections.paymentTerms || parseResult.paymentTerms.value ? 'confirmed' : 'missing'} />
                        <select
                          value={selections.paymentTerms || parseResult.paymentTerms.value || ''}
                          onChange={e => setSelections(prev => ({ ...prev, paymentTerms: e.target.value }))}
                        >
                          <option value="">Use customer default</option>
                          {parseResult.paymentTerms.suggestions.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                    </div>
                  )}

                  {parseResult.note.value && (
                    <div className="voice-order-review-row">
                      <div className="voice-order-review-label">Note</div>
                      <div className="voice-order-review-value">{parseResult.note.value}</div>
                    </div>
                  )}

                  <div className="voice-order-apply-actions">
                    <button type="button" onClick={handleApply} disabled={!canApply}>
                      Apply to Order Form
                    </button>
                    <button type="button" className="soft" onClick={resetVoiceSession}>Clear Voice Order</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
