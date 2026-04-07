import { useState } from 'react'
import { Loader2, Check, X } from 'lucide-react'
import { useReaderStore } from '../store/readerStore'
import { lookupLongest } from '../lib/dictService'
import { mineCard, isAnkiAvailable } from '../lib/ankiConnect'
import { generateCard, buildBasicCard } from '../lib/generateCard'

export function MineWordPicker() {
  const {
    showMinePicker,
    activeSentence,
    ankiDeck,
    claudeApiKey,
    cardType,
    setShowMinePicker,
  } = useReaderStore()

  const [state, setState] = useState<'picking' | 'loading' | 'success' | 'error'>('picking')
  const [errorMsg, setErrorMsg] = useState('')

  if (!showMinePicker || !activeSentence) return null

  const handleClose = () => {
    setState('picking')
    setShowMinePicker(false)
  }

  const handleCharTap = async (chars: string[], fromIndex: number) => {
    const text = chars.slice(fromIndex).join('')
    setState('loading')

    try {
      const entry = await lookupLongest(text)
      if (!entry) {
        setErrorMsg('Word not found')
        setState('error')
        setTimeout(() => setState('picking'), 2000)
        return
      }

      const available = await isAnkiAvailable()
      if (!available) {
        setErrorMsg('Anki not running')
        setState('error')
        setTimeout(() => setState('picking'), 2500)
        return
      }

      let front: string
      let back: string

      if (claudeApiKey) {
        const generated = await generateCard(entry, activeSentence.text, claudeApiKey)
        // Override front if sentence card mode
        if (cardType === 'sentence') {
          front = buildSentenceFront(activeSentence.text, entry.word)
        } else {
          front = generated.front
        }
        back = generated.back
      } else {
        const basic = buildBasicCard(entry, activeSentence.text)
        if (cardType === 'sentence') {
          front = buildSentenceFront(activeSentence.text, entry.word)
        } else {
          front = basic.front
        }
        back = basic.back
      }

      await mineCard({ front, back, sentence: activeSentence.text, word: entry.word, jlpt: entry.jlpt, deck: ankiDeck })
      setState('success')
      setTimeout(handleClose, 1500)
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Failed')
      setState('error')
      setTimeout(() => setState('picking'), 2500)
    }
  }

  const chars = [...activeSentence.text]

  return (
    <>
      <div className="absolute inset-0 bg-black/60 z-40" onClick={handleClose} />
      <div
        className="absolute bottom-[52px] left-0 right-0 z-50 rounded-t-[16px] px-5 pt-4 pb-6"
        style={{ backgroundColor: '#1A1A1A', boxShadow: '0 -4px 24px rgba(0,0,0,0.5)' }}
      >
        {/* Handle + close */}
        <div className="flex items-center justify-between mb-4">
          <p className="font-sans text-[13px] text-muted-foreground">
            {state === 'picking' ? 'Tap the word to mine' : state === 'loading' ? 'Looking up…' : state === 'success' ? 'Added to Anki!' : errorMsg}
          </p>
          <button onClick={handleClose} className="p-1 active:opacity-60">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Sentence with tappable chars */}
        <div className="font-serif text-[18px] leading-[2.2] text-center">
          {state === 'loading' && (
            <div className="flex items-center justify-center py-4 gap-2">
              <Loader2 className="w-5 h-5 text-accent animate-spin" />
              <span className="font-sans text-sm text-muted-foreground">Generating card…</span>
            </div>
          )}
          {state === 'success' && (
            <div className="flex items-center justify-center py-4 gap-2">
              <Check className="w-6 h-6" style={{ color: '#4CAF50' }} />
              <span className="font-sans text-sm" style={{ color: '#4CAF50' }}>Added to Anki!</span>
            </div>
          )}
          {(state === 'picking' || state === 'error') && chars.map((char, i) => (
            <span
              key={i}
              className="cursor-pointer rounded px-[1px] transition-colors active:bg-accent/30"
              style={{ color: isJapanese(char) ? '#eee' : '#666' }}
              onClick={() => isJapanese(char) && handleCharTap(chars, i)}
            >
              {char}
            </span>
          ))}
        </div>

        <p className="font-sans text-[11px] text-muted-foreground text-center mt-3">
          Card type: <span style={{ color: '#C8A96E' }}>{cardType === 'sentence' ? 'Sentence + word' : 'Word only'}</span>
          {' · '}AI: <span style={{ color: claudeApiKey ? '#4CAF50' : '#666' }}>{claudeApiKey ? 'on' : 'off'}</span>
        </p>
      </div>
    </>
  )
}

function isJapanese(ch: string): boolean {
  const code = ch.charCodeAt(0)
  return (code >= 0x3040 && code <= 0x9FFF) || (code >= 0xF900 && code <= 0xFAFF)
}

function buildSentenceFront(sentence: string, word: string): string {
  const highlighted = sentence.replace(
    word,
    `<b style="color:#C8A96E;text-decoration:underline">${word}</b>`
  )
  return `<div class="sentence-front">${highlighted}</div>`
}
