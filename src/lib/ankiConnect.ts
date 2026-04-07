// AnkiConnect integration — requires Anki Desktop running with AnkiConnect add-on

const ANKI_URL = 'http://localhost:8765'
const DECK = 'Ondoku'
const MODEL = 'Ondoku Mining'

async function invoke(action: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const res = await fetch(ANKI_URL, {
    method: 'POST',
    body: JSON.stringify({ action, version: 6, params }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return data.result
}

export async function isAnkiAvailable(): Promise<boolean> {
  try {
    await invoke('version')
    return true
  } catch {
    return false
  }
}

async function ensureDeckAndModel() {
  const decks = (await invoke('deckNames')) as string[]
  if (!decks.includes(DECK)) {
    await invoke('createDeck', { deck: DECK })
  }

  const models = (await invoke('modelNames')) as string[]
  if (!models.includes(MODEL)) {
    await invoke('createModel', {
      modelName: MODEL,
      inOrderFields: ['Word', 'Reading', 'Meaning', 'Sentence', 'JLPT'],
      css: `
        .card { font-family: serif; font-size: 20px; text-align: center; background: #111; color: #eee; }
        .word { font-size: 32px; margin-bottom: 8px; }
        .reading { font-size: 18px; color: #C8A96E; margin-bottom: 16px; }
        .meaning { font-size: 16px; color: #ccc; margin-bottom: 16px; }
        .sentence { font-size: 14px; color: #888; font-style: italic; }
        .jlpt { font-size: 11px; color: #666; margin-top: 8px; }
      `,
      cardTemplates: [
        {
          Name: 'Recognition',
          Front: '<div class="word">{{Word}}</div>',
          Back: `{{FrontSide}}<hr>
<div class="reading">{{Reading}}</div>
<div class="meaning">{{Meaning}}</div>
<div class="sentence">{{Sentence}}</div>
<div class="jlpt">{{JLPT}}</div>`,
        },
      ],
    })
  }
}

export interface MineCardParams {
  word: string
  reading: string
  meanings: string[]
  sentence: string
  jlpt: number | null
}

export async function mineCard(params: MineCardParams): Promise<void> {
  await ensureDeckAndModel()

  const jlptLabel = params.jlpt ? `N${params.jlpt}` : ''
  const meaning = params.meanings.slice(0, 3).join('; ')
  // Highlight the mined word in the sentence
  const highlighted = params.sentence.replace(
    params.word,
    `<b style="color:#C8A96E">${params.word}</b>`
  )

  await invoke('addNote', {
    note: {
      deckName: DECK,
      modelName: MODEL,
      fields: {
        Word: params.word,
        Reading: params.reading,
        Meaning: meaning,
        Sentence: highlighted,
        JLPT: jlptLabel,
      },
      tags: jlptLabel ? [`jlpt::${jlptLabel}`] : [],
      options: { allowDuplicate: false, duplicateScope: 'deck' },
    },
  })
}
