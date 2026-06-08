import { useEffect, useRef, useState } from 'react'
import { css } from '@firebolt-dev/css'

import { AVATAR_CRUSADER, AVATAR_SARACEN } from '../../core/extras/playerAvatars'

export { AVATAR_CRUSADER, AVATAR_SARACEN }

const MAX_NAME_LENGTH = 24
const SARACEN_JOIN_DURATION_MS = 5000
const FADE_MS = 600

const ASSETS = {
  bg: '/assets/willsitbackground.png',
  scroll: '/assets/scroll.png',
  titleMusic: '/assets/battleprep.mp3',
  crusaderJoin: '/assets/war.mp3',
  saracenJoin: '/assets/akbar.mp3',
}

const imagePreloadCache = new Map()

async function preloadImage(src) {
  if (imagePreloadCache.has(src)) return imagePreloadCache.get(src)

  const promise = (async () => {
    const response = await fetch(src)
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.src = url
    await img.decode()
    return url
  })()

  imagePreloadCache.set(src, promise)
  return promise
}

async function preloadAudio(src) {
  const response = await fetch(src)
  await response.blob()
}

const titleAssetsReady = Promise.all([
  preloadImage(ASSETS.bg),
  preloadImage(ASSETS.scroll),
  preloadAudio(ASSETS.titleMusic),
]).then(([bg, scroll]) => ({ bg, scroll }))

function stopAudio(audio) {
  if (!audio) return
  audio.pause()
  audio.src = ''
}

function playFactionJoinSound(side) {
  const src = side === 'saracen' ? ASSETS.saracenJoin : ASSETS.crusaderJoin
  const sfx = new Audio(src)
  sfx.volume = 0.8
  sfx.play().catch(() => {})
  if (side === 'saracen') {
    setTimeout(() => stopAudio(sfx), SARACEN_JOIN_DURATION_MS)
  }
}

export function TitleScreen({ onStart }) {
  const [name, setName] = useState('')
  const [side, setSide] = useState('crusader')
  const [imageUrls, setImageUrls] = useState(null)
  const [showTitle, setShowTitle] = useState(false)
  const titleMusicRef = useRef(null)
  const imageUrlsRef = useRef(null)
  const usernameRef = useRef(null)

  const trimmedName = name.trim()
  const canStart = trimmedName.length > 0

  useEffect(() => {
    let cancelled = false
    titleAssetsReady
      .then(urls => {
        if (cancelled) return
        imageUrlsRef.current = urls
        setImageUrls(urls)
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!cancelled) setShowTitle(true)
          })
        })
      })
      .catch(err => console.error('[TitleScreen] failed to preload assets:', err))
    return () => {
      cancelled = true
      if (imageUrlsRef.current) {
        URL.revokeObjectURL(imageUrlsRef.current.bg)
        URL.revokeObjectURL(imageUrlsRef.current.scroll)
        imageUrlsRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!showTitle) return

    const music = new Audio(ASSETS.titleMusic)
    music.loop = true
    music.volume = 0.45
    titleMusicRef.current = music

    const startMusic = () => {
      music.play().catch(() => {})
    }

    startMusic()

    const onFirstInteraction = () => {
      startMusic()
      window.removeEventListener('pointerdown', onFirstInteraction)
      window.removeEventListener('keydown', onFirstInteraction)
    }
    window.addEventListener('pointerdown', onFirstInteraction)
    window.addEventListener('keydown', onFirstInteraction)

    usernameRef.current?.focus()

    return () => {
      window.removeEventListener('pointerdown', onFirstInteraction)
      window.removeEventListener('keydown', onFirstInteraction)
      stopAudio(titleMusicRef.current)
      titleMusicRef.current = null
    }
  }, [showTitle])

  const handleSubmit = e => {
    e.preventDefault()
    if (!canStart) return

    stopAudio(titleMusicRef.current)
    titleMusicRef.current = null
    playFactionJoinSound(side)

    onStart({
      name: trimmedName.slice(0, MAX_NAME_LENGTH),
      avatar: side === 'saracen' ? AVATAR_SARACEN : AVATAR_CRUSADER,
    })
  }

  return (
    <div
      css={css`
        position: fixed;
        inset: 0;
        background: #0a0a0f;
        pointer-events: auto;
        z-index: 10000;
        .title-loading {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1.5rem;
          background: #0a0a0f;
          z-index: 2;
          opacity: 1;
          transition: opacity ${FADE_MS}ms ease;
          pointer-events: auto;
          &.hidden {
            opacity: 0;
            pointer-events: none;
          }
        }
        .loading-heading {
          margin: 0;
          font-size: clamp(1.75rem, 5vw, 2.5rem);
          font-weight: 700;
          color: #e8dcc8;
          letter-spacing: 0.04em;
          text-align: center;
        }
        .loading-spinner {
          width: 2.5rem;
          height: 2.5rem;
          border: 3px solid rgba(232, 220, 200, 0.2);
          border-top-color: #c9a227;
          border-radius: 50%;
          animation: title-spin 0.9s linear infinite;
        }
        @keyframes title-spin {
          to {
            transform: rotate(360deg);
          }
        }
        .title-stage {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          transition: opacity ${FADE_MS}ms ease;
          &.visible {
            opacity: 1;
          }
        }
        .title-bg {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: center;
        }
        .title-overlay {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.25);
          pointer-events: none;
        }
        .title-panel {
          position: relative;
          width: min(92vw, 40rem);
          min-height: 18rem;
          padding: 14% 14% 16%;
          box-sizing: border-box;
          border: none;
          box-shadow: 0 24px 48px rgba(0, 0, 0, 0.45);
        }
        .title-scroll {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: fill;
          pointer-events: none;
        }
        .title-panel-content {
          position: relative;
          z-index: 1;
        }
        .title-heading {
          font-size: clamp(1.75rem, 5vw, 2.25rem);
          font-weight: 700;
          margin: 0 0 0.35rem;
          color: #3d2817;
          text-align: center;
          letter-spacing: 0.02em;
        }
        .title-sub {
          color: #5c4033;
          font-size: 0.95rem;
          margin: 0 0 1.5rem;
          text-align: center;
        }
        .field-label {
          display: block;
          color: #4a3424;
          font-size: 0.85rem;
          font-weight: 600;
          margin-bottom: 0.5rem;
        }
        .name-input {
          width: 100%;
          box-sizing: border-box;
          padding: 0.65rem 0.85rem;
          background: rgba(255, 248, 235, 0.65);
          border: 1px solid rgba(61, 40, 23, 0.35);
          border-radius: 6px;
          color: #3d2817;
          font-size: 1rem;
          margin-bottom: 1.25rem;
          outline: none;
          &::placeholder {
            color: rgba(61, 40, 23, 0.45);
          }
          &:focus {
            border-color: rgba(61, 40, 23, 0.65);
            background: rgba(255, 248, 235, 0.85);
          }
        }
        .side-row {
          display: flex;
          gap: 0.75rem;
          margin-bottom: 1.5rem;
        }
        .side-btn {
          flex: 1;
          padding: 0.75rem 1rem;
          background: rgba(255, 248, 235, 0.5);
          border: 1px solid rgba(61, 40, 23, 0.3);
          border-radius: 6px;
          color: #5c4033;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          &:hover {
            border-color: rgba(61, 40, 23, 0.5);
            background: rgba(255, 248, 235, 0.75);
          }
          &.crusader.selected {
            background: rgba(255, 245, 240, 0.95);
            border-color: #8b1a1a;
            color: #6b1010;
            box-shadow: inset 0 0 0 1px rgba(139, 26, 26, 0.25);
          }
          &.saracen.selected {
            background: rgba(240, 255, 240, 0.95);
            border-color: #1a5c2e;
            color: #0f3d1f;
            box-shadow: inset 0 0 0 1px rgba(26, 92, 46, 0.25);
          }
        }
        .enter-btn {
          width: 100%;
          padding: 0.85rem 1rem;
          border: none;
          border-radius: 6px;
          font-size: 1rem;
          font-weight: 700;
          cursor: pointer;
          transition: opacity 0.2s, filter 0.2s;
          color: #fff8f0;
          &.crusader {
            background: #7a1515;
            &:not(:disabled):hover {
              background: #8b1a1a;
            }
          }
          &.saracen {
            background: #1a5c2e;
            &:not(:disabled):hover {
              background: #227038;
            }
          }
          &:disabled {
            opacity: 0.35;
            cursor: not-allowed;
          }
        }
      `}
    >
      <div className={`title-loading${showTitle ? ' hidden' : ''}`}>
        <h1 className='loading-heading'>God Wills It!</h1>
        <div className='loading-spinner' aria-hidden='true' />
      </div>

      {imageUrls && (
        <div className={`title-stage${showTitle ? ' visible' : ''}`}>
          <img className='title-bg' src={imageUrls.bg} alt='' />
          <div className='title-overlay' />
          <form className='title-panel' onSubmit={handleSubmit}>
            <img className='title-scroll' src={imageUrls.scroll} alt='' />
            <div className='title-panel-content'>
              <h1 className='title-heading'>God Wills It</h1>
              <p className='title-sub'>Choose your name and allegiance</p>

              <label className='field-label' htmlFor='username'>
                Username
              </label>
              <input
                ref={usernameRef}
                id='username'
                className='name-input'
                type='text'
                value={name}
                maxLength={MAX_NAME_LENGTH}
                placeholder='Enter your name'
                autoComplete='off'
                onChange={e => setName(e.target.value)}
              />

              <span className='field-label'>Side</span>
              <div className='side-row'>
                <button
                  type='button'
                  className={`side-btn crusader${side === 'crusader' ? ' selected' : ''}`}
                  onClick={() => setSide('crusader')}
                >
                  Crusader
                </button>
                <button
                  type='button'
                  className={`side-btn saracen${side === 'saracen' ? ' selected' : ''}`}
                  onClick={() => setSide('saracen')}
                >
                  Saracen
                </button>
              </div>

              <button type='submit' className={`enter-btn ${side}`} disabled={!canStart}>
                Enter game
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
