import type { DictEntry } from './dictTypes'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

export interface GeneratedCard {
  front: string   // word + reading + pitch
  back: string    // rich HTML
}

function pitchLabel(pattern: string): string {
  // pattern is like "0", "1", "2" etc. — convert to LH notation
  const map: Record<string, string> = {
    '0': 'heiban (平板)',
    '1': 'atamadaka (頭高)',
    '2': 'nakadaka (中高)',
    '3': 'nakadaka (中高)',
    '4': 'nakadaka (中高)',
  }
  return map[pattern] ?? pattern
}

export async function generateCard(
  entry: DictEntry,
  sentence: string,
  apiKey: string
): Promise<GeneratedCard> {
  const reading = entry.readings[0] ?? ''
  const pitch = entry.pitch[0]
    ? `${entry.pitch[0].reading}【${entry.pitch[0].pattern}】 (${pitchLabel(entry.pitch[0].pattern)})`
    : null
  const jlpt = entry.jlpt ? `N${entry.jlpt}` : null
  const meanings = entry.senses
    .slice(0, 3)
    .map((s, i) => `${i + 1}. [${s.pos[0] ?? ''}] ${s.glosses.slice(0, 2).join(', ')}`)
    .join('\n')
  const kanjiInfo = entry.kanjiBreakdown
    .map((k) => `${k.literal}: ${k.meanings[0] ?? ''} (on: ${k.readings_on[0] ?? '-'}, kun: ${k.readings_kun[0] ?? '-'})`)
    .join('\n')

  const prompt = `You are a Japanese language card generator. Generate a rich Anki card back for the word below.

Word: ${entry.word}
Reading: ${reading}
${pitch ? `Pitch accent: ${pitch}` : ''}
${jlpt ? `JLPT: ${jlpt}` : ''}
Dictionary meanings:
${meanings}
${kanjiInfo ? `\nKanji breakdown:\n${kanjiInfo}` : ''}
${sentence ? `\nContext sentence: ${sentence}` : ''}

Output ONLY a JSON object (no markdown, no code fences) with these exact keys:
{
  "pitch_display": "e.g. 【LHHHHL】 (heiban) — leave empty string if unknown",
  "kanji_components": [{"kanji": "着信", "reading": "ちゃくしん", "meaning": "incoming call", "components": [{"char": "着", "meaning": "arrive"}, {"char": "信", "meaning": "message"}]}],
  "core_meaning": "2-3 sentence explanation including nuance and usage context",
  "metaphorical": "any metaphorical or extended usage, empty string if none",
  "examples": [{"jp": "日本語の例文", "reading": "ひらがな reading", "en": "English translation"}],
  "similar": [{"word": "類語", "reading": "reading", "meaning": "brief meaning"}],
  "opposites": [{"word": "対語", "reading": "reading", "meaning": "brief meaning"}],
  "interesting": "one interesting cultural/linguistic note, empty string if none"
}

Provide 3 natural example sentences. Keep similar/opposites to 2-3 items each.`

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) throw new Error(`API error: ${res.status}`)
  const data = await res.json()
  const raw = data.content[0].text.trim()

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Failed to parse AI response')
  }

  const back = renderBack(entry, reading, parsed)
  const front = renderFront(entry, reading, parsed.pitch_display as string)

  return { front, back }
}

function renderFront(entry: DictEntry, reading: string, pitchDisplay: string): string {
  return `<div class="word">${entry.word}</div>
<div class="reading">${reading}</div>
${pitchDisplay ? `<div class="pitch">${pitchDisplay}</div>` : ''}
${entry.jlpt ? `<div class="jlpt">N${entry.jlpt}</div>` : ''}`
}

function renderBack(entry: DictEntry, reading: string, d: Record<string, unknown>): string {
  const kanji = (d.kanji_components as Array<{kanji:string,reading:string,meaning:string,components:{char:string,meaning:string}[]}> ?? [])
  const examples = (d.examples as Array<{jp:string,reading:string,en:string}> ?? [])
  const similar = (d.similar as Array<{word:string,reading:string,meaning:string}> ?? [])
  const opposites = (d.opposites as Array<{word:string,reading:string,meaning:string}> ?? [])

  const kanjiHtml = kanji.length ? `
<div class="section">
  <div class="section-title">🧩 Kanji Components</div>
  ${kanji.map(k => `
    <div class="kanji-block">
      <span class="kanji-word">${k.kanji}</span><span class="kanji-reading">（${k.reading}）</span> — ${k.meaning}<br>
      <span class="kanji-chars">${k.components.map(c => `${c.char}（${c.meaning}）`).join(' + ')}</span>
    </div>`).join('')}
</div>` : ''

  const meaningHtml = `
<div class="section">
  <div class="section-title">💡 Meaning</div>
  <div class="meaning-text">${d.core_meaning ?? ''}</div>
  ${d.metaphorical ? `<div class="metaphor">${d.metaphorical}</div>` : ''}
</div>`

  const examplesHtml = examples.length ? `
<div class="section">
  <div class="section-title">🧾 Examples</div>
  ${examples.map(e => `
    <div class="example">
      <div class="example-jp">${e.jp}</div>
      <div class="example-reading">${e.reading}</div>
      <div class="example-en">"${e.en}"</div>
    </div>`).join('')}
</div>` : ''

  const similarHtml = similar.length ? `
<div class="section">
  <div class="section-title">🔁 Similar Words</div>
  ${similar.map(s => `<div class="related"><span class="related-word">${s.word}</span>（${s.reading}） — ${s.meaning}</div>`).join('')}
</div>` : ''

  const oppositesHtml = opposites.length ? `
<div class="section">
  <div class="section-title">⚖️ Opposites</div>
  ${opposites.map(s => `<div class="related"><span class="related-word">${s.word}</span>（${s.reading}） — ${s.meaning}</div>`).join('')}
</div>` : ''

  const interestingHtml = d.interesting ? `
<div class="section">
  <div class="section-title">✨ Note</div>
  <div class="interesting">${d.interesting}</div>
</div>` : ''

  return `
<div class="word">${entry.word}</div>
<div class="reading">${reading}</div>
${d.pitch_display ? `<div class="pitch">${d.pitch_display}</div>` : ''}
${kanji.length ? '<hr>' : ''}
${kanjiHtml}
<hr>
${meaningHtml}
${examplesHtml}
${similar.length || opposites.length ? '<hr>' : ''}
${similarHtml}
${oppositesHtml}
${interestingHtml}`
}
