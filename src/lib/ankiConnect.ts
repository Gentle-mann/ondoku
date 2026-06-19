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

const MODEL_CSS = `
        .card { font-family: "Hiragino Mincho ProN", "Yu Mincho", serif; font-size: 19px;
                text-align: center; background: #202020; color: #F0EDE8; padding: 18px; line-height: 1.75; }
        .word { font-size: 40px; margin-bottom: 6px; }
        .reading { font-size: 22px; color: #D9BE7C; margin-bottom: 6px; }
        .pitch { font-size: 14px; color: #BDB7AE; margin-bottom: 6px; }
        .jlpt { display:inline-block; font-size:12px; border:1px solid #BDB7AE; color:#D0CBC2;
                padding: 1px 6px; border-radius: 4px; margin: 4px 2px 8px; }
        .freq { font-size: 12px; color: #BDB7AE; margin-bottom: 8px; }
        .alt-readings { font-size: 13px; color: #BDB7AE; margin-bottom: 4px; }
        hr { border: none; border-top: 1px solid #3A3A3A; margin: 14px 0; }
        .section { text-align: left; margin-bottom: 16px; }
        .section-title { font-size: 13px; color: #BDB7AE; margin-bottom: 8px;
                         font-family: sans-serif; text-transform: uppercase; letter-spacing: .05em; }
        .sense { margin-bottom: 10px; }
        .pos { display: block; font-size: 12px; color: #BDB7AE; font-family: sans-serif; margin-bottom: 3px; }
        .gloss { display: block; font-size: 17px; color: #F0EDE8; }
        .kanji-block { display: flex; align-items: baseline; gap: 8px; margin-bottom: 10px;
                       padding: 10px 12px; background: #262626; border-radius: 10px; flex-wrap: wrap; }
        .kanji-char { font-size: 30px; color: #F0EDE8; min-width: 36px; }
        .kanji-meaning { font-size: 15px; color: #D0CBC2; flex: 1; }
        .kanji-jlpt { font-size: 11px; color: #BDB7AE; border: 1px solid #4A4A4A;
                      padding: 1px 4px; border-radius: 3px; }
        .kanji-readings { width: 100%; margin-left: 44px; margin-top: 6px;
                          display: flex; flex-direction: column; gap: 5px; }
        .kanji-reading-row { display: flex; align-items: flex-start; gap: 8px; }
        .kanji-reading-label { flex: 0 0 auto; min-width: 22px; font-size: 14px; color: #BDB7AE;
                               font-family: "Hiragino Mincho ProN", "Yu Mincho", serif; padding-top: 3px; }
        .kanji-reading-chips { display: flex; flex-wrap: wrap; gap: 5px; }
        .kanji-reading-chip { font-family: sans-serif; font-size: 15px; color: #F0EDE8;
                              background: #303030; padding: 2px 9px; border-radius: 6px; }
        .kanji-story { width: 100%; margin-left: 44px; font-size: 14px; color: #D0CBC2;
                       text-align: left; line-height: 1.55; margin-top: 6px; }
        .kanji-story-src { display: inline-block; font-size: 11px; color: #D9BE7C;
                           font-family: sans-serif; text-transform: uppercase;
                           letter-spacing: .04em; margin-right: 6px; opacity: .9; }
        .kanji-word { color: #D9BE7C; font-size: 18px; }
        .kanji-reading { color: #D0CBC2; }
        .kanji-chars { font-size: 14px; color: #D0CBC2; }
        .meaning-text { font-size: 17px; color: #F0EDE8; margin-bottom: 6px; }
        .metaphor { font-size: 14px; color: #D0CBC2; font-style: italic; }
        .example { margin-bottom: 12px; }
        .example-jp { font-size: 18px; }
        .example-reading { font-size: 13px; color: #BDB7AE; }
        .example-en { font-size: 15px; color: #D0CBC2; }
        .related { font-size: 16px; margin-bottom: 5px; }
        .related-word { color: #D9BE7C; }
        .interesting { font-size: 15px; color: #D0CBC2; font-style: italic; }
        .sentence-ctx { font-size: 14px; color: #BDB7AE; font-style: italic; text-align: left; }
        .sentence-front { font-size: 24px; line-height: 1.85; }
        .ctx-translation { font-size: 16px; color: #D0CBC2; margin-bottom: 6px; font-style: italic; }
        .ctx-meaning { font-size: 15px; color: #D0CBC2; border-left: 2px solid #D9BE7C; padding-left: 11px; margin-top: 6px; }
      `

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
      css: MODEL_CSS,
      cardTemplates: [
        {
          Name: 'Recognition',
          Front: '{{Front}}',
          Back: '{{Front}}<hr>{{Back}}',
        },
      ],
    })
  } else {
    // Model exists — keep template and styling in sync
    await invoke('updateModelTemplates', {
      model: {
        name: MODEL,
        templates: {
          Recognition: {
            Front: '{{Front}}',
            Back: '{{Front}}<hr>{{Back}}',
          },
        },
      },
    })
    await invoke('updateModelStyling', {
      model: { name: MODEL, css: MODEL_CSS },
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

export async function storeMediaFile(filename: string, base64data: string): Promise<void> {
  await invoke('storeMediaFile', {
    filename,
    data: base64data,
    deleteExisting: true,
  })
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
