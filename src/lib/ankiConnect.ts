// AnkiConnect integration — requires Anki Desktop running with AnkiConnect add-on

const ANKI_URL = 'http://localhost:8765'
const MODEL = 'Ondoku v2'

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

async function ensureDeckAndModel(deck: string) {
  const decks = (await invoke('deckNames')) as string[]
  if (!decks.includes(deck)) {
    await invoke('createDeck', { deck })
  }

  const models = (await invoke('modelNames')) as string[]
  if (!models.includes(MODEL)) {
    await invoke('createModel', {
      modelName: MODEL,
      inOrderFields: ['Front', 'Back', 'Sentence'],
      css: `
        .card { font-family: "Hiragino Mincho ProN", serif; font-size: 18px; text-align: center;
                background: #111; color: #eee; padding: 16px; line-height: 1.7; }
        .word { font-size: 36px; margin-bottom: 4px; }
        .reading { font-size: 20px; color: #C8A96E; margin-bottom: 4px; }
        .pitch { font-size: 13px; color: #888; margin-bottom: 8px; }
        .jlpt { display:inline-block; font-size:11px; border:1px solid #666; color:#666;
                padding: 1px 6px; border-radius: 4px; margin-bottom: 12px; }
        hr { border: none; border-top: 1px solid #2a2a2a; margin: 12px 0; }
        .section { text-align: left; margin-bottom: 14px; }
        .section-title { font-size: 13px; color: #888; margin-bottom: 6px; font-family: sans-serif; }
        .kanji-block { margin-bottom: 6px; font-size: 15px; }
        .kanji-word { color: #C8A96E; font-size: 17px; }
        .kanji-reading { color: #aaa; }
        .kanji-chars { font-size: 13px; color: #666; }
        .meaning-text { font-size: 15px; color: #ddd; margin-bottom: 6px; }
        .metaphor { font-size: 13px; color: #888; font-style: italic; }
        .example { margin-bottom: 10px; }
        .example-jp { font-size: 16px; }
        .example-reading { font-size: 12px; color: #888; }
        .example-en { font-size: 13px; color: #aaa; }
        .related { font-size: 14px; margin-bottom: 4px; }
        .related-word { color: #C8A96E; }
        .interesting { font-size: 14px; color: #aaa; font-style: italic; }
        .sentence-ctx { font-size: 13px; color: #666; font-style: italic; margin-top: 8px; }
      `,
      cardTemplates: [
        {
          Name: 'Recognition',
          Front: '{{Front}}',
          Back: '{{Back}}<div class="sentence-ctx">{{Sentence}}</div>',
        },
      ],
    })
  }
}

export interface MineCardParams {
  front: string
  back: string
  sentence: string
  word: string
  jlpt: number | null
  deck: string
}

export async function mineCard(params: MineCardParams): Promise<void> {
  await ensureDeckAndModel(params.deck)

  const tags = params.jlpt ? [`jlpt::N${params.jlpt}`] : []

  await invoke('addNote', {
    note: {
      deckName: params.deck,
      modelName: MODEL,
      fields: {
        Front: params.front,
        Back: params.back,
        Sentence: params.sentence,
      },
      tags,
      options: { allowDuplicate: false, duplicateScope: 'deck' },
    },
  })
}
