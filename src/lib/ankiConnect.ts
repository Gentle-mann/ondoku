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
        .card { font-family: "Hiragino Mincho ProN", "Yu Mincho", serif; font-size: 18px;
                text-align: center; background: #111; color: #eee; padding: 16px; line-height: 1.7; }
        .word { font-size: 36px; margin-bottom: 4px; }
        .reading { font-size: 20px; color: #C8A96E; margin-bottom: 4px; }
        .pitch { font-size: 13px; color: #888; margin-bottom: 4px; }
        .jlpt { display:inline-block; font-size:11px; border:1px solid #666; color:#666;
                padding: 1px 6px; border-radius: 4px; margin: 4px 2px 8px; }
        .freq { font-size: 11px; color: #555; margin-bottom: 8px; }
        .alt-readings { font-size: 12px; color: #666; margin-bottom: 4px; }
        hr { border: none; border-top: 1px solid #2a2a2a; margin: 12px 0; }
        .section { text-align: left; margin-bottom: 14px; }
        .section-title { font-size: 12px; color: #666; margin-bottom: 8px;
                         font-family: sans-serif; text-transform: uppercase; letter-spacing: .05em; }
        .sense { margin-bottom: 8px; }
        .pos { display: block; font-size: 11px; color: #666; font-family: sans-serif; margin-bottom: 2px; }
        .gloss { display: block; font-size: 15px; color: #ddd; }
        .kanji-block { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px;
                       padding: 8px 10px; background: #1a1a1a; border-radius: 8px; }
        .kanji-char { font-size: 26px; color: #eee; min-width: 32px; }
        .kanji-readings { font-size: 13px; color: #C8A96E; }
        .kanji-meaning { font-size: 13px; color: #aaa; flex: 1; }
        .kanji-jlpt { font-size: 10px; color: #555; border: 1px solid #333;
                      padding: 1px 4px; border-radius: 3px; }
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
        .sentence-ctx { font-size: 13px; color: #666; font-style: italic; text-align: left; }
        .sentence-front { font-size: 22px; line-height: 1.8; }
        .ctx-translation { font-size: 15px; color: #ccc; margin-bottom: 6px; font-style: italic; }
        .ctx-meaning { font-size: 14px; color: #aaa; border-left: 2px solid #C8A96E; padding-left: 10px; margin-top: 6px; }
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
