import { useEffect, useRef, useState } from 'react'
import { css } from '@firebolt-dev/css'

import { AVATAR_CRUSADER } from '../../core/extras/playerAvatars'
import { prefetchGameAssets } from '../../core/extras/assetPrefetch'

export { AVATAR_CRUSADER }

const MAX_NAME_LENGTH = 24
const FADE_MS = 600

const ASSETS = {
  bg: '/assets/gladimage.png',
  scroll: '/assets/scroll.png',
  titleMusic: '/assets/battleprep.mp3',
  enterArena: '/assets/war.mp3',
}

const imagePreloadCache = new Map()

function loadImageSrc(src) {
  if (imagePreloadCache.has(src)) return imagePreloadCache.get(src)

  const promise = new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(src)
    img.onerror = () => reject(new Error(`failed to load ${src}`))
    img.src = src
  })

  imagePreloadCache.set(src, promise)
  return promise
}

// Only gate the spinner on the background — scroll and music load in the background.
// index.html already preloads gladimage.png + scroll.png while the JS bundle loads.
const titleBgReady = loadImageSrc(ASSETS.bg)
const titleScrollReady = loadImageSrc(ASSETS.scroll)

function stopAudio(audio) {
  if (!audio) return
  audio.pause()
  audio.src = ''
}

function playEnterArenaSound() {
  const sfx = new Audio(ASSETS.enterArena)
  sfx.volume = 0.8
  sfx.play().catch(() => {})
}

export function TitleScreen({ onStart }) {
  const [name, setName] = useState('')
  const [scrollReady, setScrollReady] = useState(false)
  const [showTitle, setShowTitle] = useState(false)
  const titleMusicRef = useRef(null)
  const usernameRef = useRef(null)

  const trimmedName = name.trim()
  const canStart = trimmedName.length > 0

  useEffect(() => {
    let cancelled = false
    titleBgReady
      .then(() => {
        if (!cancelled) setShowTitle(true)
      })
      .catch(err => console.error('[TitleScreen] failed to preload background:', err))

    titleScrollReady
      .then(() => {
        if (!cancelled) setScrollReady(true)
      })
      .catch(err => console.error('[TitleScreen] failed to preload scroll:', err))

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!showTitle) return
    prefetchGameAssets()
  }, [showTitle])

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
    playEnterArenaSound()

    onStart({
      name: trimmedName.slice(0, MAX_NAME_LENGTH),
      avatar: AVATAR_CRUSADER,
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
          display: inline-block;
          max-width: min(92vw, 22rem);
          border: none;
          background: transparent;
        }
        .title-scroll {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: fill;
          pointer-events: none;
          opacity: 0;
          transition: opacity ${FADE_MS}ms ease;
          &.ready {
            opacity: 1;
          }
        }
        .title-panel-content {
          position: relative;
          z-index: 1;
          padding: 2rem 2.75rem 2.25rem;
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
          margin-bottom: 1.5rem;
          outline: none;
          &::placeholder {
            color: rgba(61, 40, 23, 0.45);
          }
          &:focus {
            border-color: rgba(61, 40, 23, 0.65);
            background: rgba(255, 248, 235, 0.85);
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
          background: #7a1515;
          &:not(:disabled):hover {
            background: #8b1a1a;
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

      {showTitle && (
        <div className='title-stage visible'>
          <img className='title-bg' src={ASSETS.bg} alt='' />
          <div className='title-overlay' />
          <form className='title-panel' onSubmit={handleSubmit}>
            <img className={`title-scroll${scrollReady ? ' ready' : ''}`} src={ASSETS.scroll} alt='' />
            <div className='title-panel-content'>
              <h1 className='title-heading'>God Wills It</h1>
              <p className='title-sub'>Enter your name to join the Arena</p>

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

              <button type='submit' className='enter-btn' disabled={!canStart}>
                Enter the Arena
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
