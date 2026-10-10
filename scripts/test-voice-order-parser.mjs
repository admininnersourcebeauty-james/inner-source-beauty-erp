import {
  parseVoiceOrderTranscript,
  parseSpokenQuantity,
  parseVoiceProductSegments,
  splitVoiceSegments,
  buildVoiceOrderFormPatch,
  voiceOrderReviewReady,
  DEFAULT_VOICE_LANGUAGE,
  DEFAULT_VOICE_FULFILLMENT_METHOD,
  VOICE_LANGUAGE_OPTIONS,
} from '../src/voiceOrder.js'

const customers = [
  { id: 'c1', company: 'Coastline Beauty', name: 'Coastline Contact' },
  { id: 'c2', company: 'Beauty Me MD', name: 'Dr Kim' },
  { id: 'c3', company: 'The Margaux Method Co', name: 'Margaux Owner' },
  { id: 'c4', company: 'CCC', name: 'CCC Contact' },
]

const inventory = [
  { id: 'p1', style: 'RETURN 22', brand: 'Inner Source' },
  { id: 'p2', style: 'EYE RELAX CREAM', brand: '' },
  { id: 'p3', style: 'S-Style Secret Y-Zone Serum', brand: '' },
  { id: 'p4', style: 'Vitamin C 20', brand: '' },
  { id: 'p5', style: 'PDRN 600', brand: '' },
  { id: 'p6', style: 'Product 35ML', brand: '' },
]

const staffUsers = [
  { id: 's1', full_name: 'Jane Smith', role: 'Staff', status: 'active' },
]

const examples = [
  'Coastline Beauty, three Return 22, two Eye Relax Cream, salesperson Jane, company delivery.',
  'Beauty Me MD, five Return 22, salesperson Jane.',
  'The Margaux Method Company, twelve S-Style Secret Y-Zone Serum, Zelle, company delivery.',
  'Return 22 qty 3',
  'Return 22 quantity 3',
  'Return 22 3 units',
  'Return 22 three pieces',
  'Return 22 세 개',
  'CCC CCC CCC CCC CCC three return CCC three return 22',
  'CCC, three Return 22',
  'CCC, Return 22 three',
  'CCC, Return 22 3개',
  'CCC, return twenty two three',
  'CCC, 리턴 22 three',
  'CCC return 22 3',
  'CCC 3 RETURN 22',
  'CCC RETURN 22 three',
  'CCC RETURN 22 3개',
  'CCC RETURN twenty two three',
  'CCC Vitamin C 20 3',
  'CCC PDRN 600 3',
  'CCC Product 35ML 3',
  'CCC, Return 22, 3개',
  'CCC, Return 22, quantity 3',
]

console.log('=== Speech language defaults ===')
console.log('DEFAULT_VOICE_LANGUAGE:', DEFAULT_VOICE_LANGUAGE)
console.log('VOICE_LANGUAGE_OPTIONS:', VOICE_LANGUAGE_OPTIONS.map(o => o.value).join(', '))
console.log('createSpeechRecognition() lang: en-US (browser-only; verified in source)')
console.log('createSpeechRecognition("ko-KR") lang: ko-KR (browser-only; verified in source)')

console.log('\n=== Quantity parser ===')
for (const q of ['three', 'twelve', 'twenty one', 'qty 3', 'quantity 5', '3 units', 'two pieces', '세 개']) {
  console.log(`"${q}" ->`, parseSpokenQuantity(q))
}

console.log('\n=== Segment debug ===')
const dbgText = 'Coastline Beauty, three Return 22, two Eye Relax Cream, salesperson Jane, company delivery.'
console.log('segments:', splitVoiceSegments(dbgText))
console.log('products:', parseVoiceProductSegments(dbgText))

console.log('\n=== English order examples ===')
for (const text of examples) {
  const parsed = parseVoiceOrderTranscript(text, { customers, inventory, staffUsers })
  console.log('\nTranscript:', text)
  console.log('  Customer:', parsed.customer.match?.company || parsed.customer.phrase, `(${parsed.customer.status})`)
  console.log('  Items:', parsed.items.map(i => `${i.name} x${i.qty} -> ${i.match?.style || '?'} (${i.status}) suggestions:${i.suggestions.map(s => s.label).join('|')}`).join('; ') || 'none')
  console.log('  Sales Person:', parsed.salesPerson.match?.full_name || parsed.salesPerson.phrase || '—', `(${parsed.salesPerson.status})`)
  console.log('  Fulfillment:', parsed.fulfillment.value || '—')
}

console.log('\n=== Voice Order defaults ===')
const defaultStaff = { id: 's1', full_name: 'Jane Smith', role: 'Staff', status: 'active' }
const quickText = 'CCC, Return 22, 3개'
const quickParsed = parseVoiceOrderTranscript(quickText, { customers, inventory, staffUsers: [defaultStaff] })
const quickDefaults = {
  defaultSalesPersonId: defaultStaff.id,
  defaultFulfillmentMethod: DEFAULT_VOICE_FULFILLMENT_METHOD,
}
const quickPatch = buildVoiceOrderFormPatch(quickParsed, {}, quickDefaults)
console.log('Transcript:', quickText)
console.log('  Customer:', quickPatch.customerId === 'c4' ? 'CCC' : quickPatch.customerId)
console.log('  Product line:', quickPatch.lines[0]?.label, 'x' + quickPatch.lines[0]?.qty)
console.log('  Sales Person default:', quickPatch.salesPersonId, quickPatch.salesPersonIsDefault ? '(Default)' : '')
console.log('  Fulfillment default:', quickPatch.shippingMethod, quickPatch.fulfillmentIsDefault ? '(Default)' : '')
console.log('  Review ready:', voiceOrderReviewReady(quickParsed, {}, quickDefaults))

const spokenStaffText = 'CCC, Return 22, 3개, salesperson Jane, company delivery'
const spokenStaffParsed = parseVoiceOrderTranscript(spokenStaffText, { customers, inventory, staffUsers: [defaultStaff] })
const spokenStaffPatch = buildVoiceOrderFormPatch(spokenStaffParsed, {}, quickDefaults)
console.log('\nTranscript:', spokenStaffText)
console.log('  Sales Person spoken:', spokenStaffPatch.salesPersonId, spokenStaffPatch.salesPersonIsDefault ? '(Default)' : '(Spoken)')
console.log('  Fulfillment spoken:', spokenStaffPatch.shippingMethod, spokenStaffPatch.fulfillmentIsDefault ? '(Default)' : '(Spoken)')
