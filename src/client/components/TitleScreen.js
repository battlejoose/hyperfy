import { useEffect, useRef, useState } from 'react'
import { css } from '@firebolt-dev/css'

import { AVATAR_CRUSADER } from '../../core/extras/playerAvatars'
import { prefetchGameAssets } from '../../core/extras/assetPrefetch'
import { isTouch } from '../utils'
import { TitleArenaRankings } from './ArenaRankings'

/** Desktop HTML/WebAudio clip level. */
const PROXIMO_CLIP_VOLUME = 0.25
/** Mobile is half of desktop — iOS also ignores video.volume, so we use a GainNode. */
const PROXIMO_CLIP_VOLUME_MOBILE = PROXIMO_CLIP_VOLUME * 0.5

export { AVATAR_CRUSADER }

const MAX_NAME_LENGTH = 24
const FADE_MS = 600

export const TITLE_BG_SRC = '/assets/gladiatorbackground.webp'

const ASSETS = {
  bg: TITLE_BG_SRC,
  scroll: '/assets/scroll.png',
  titleMusic: '/assets/battleprep.mp3',
  proximoClip: '/assets/proximoclip.webm',
  clapping: '/assets/clapping.mp3',
}

/** When the Proximo clip reaches this time (seconds), the clapping sound plays. */
const CLAPPING_AT_SECONDS = 35

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
// index.html already preloads gladiatorbackground.webp + scroll.png while the JS bundle loads.
const titleBgReady = loadImageSrc(ASSETS.bg)
const titleScrollReady = loadImageSrc(ASSETS.scroll)

function stopAudio(audio) {
  if (!audio) return
  audio.pause()
  audio.src = ''
}

// The Proximo talking-head video lives outside React on document.body so it
// survives the title screen unmounting and keeps playing into the arena.
let proximoClipVideo = null
let proximoClipFinished = false
let proximoClipRetryAttached = false
let proximoClipAudioCtx = null
let proximoClipGain = null

function getProximoClipVolume() {
  return isTouch ? PROXIMO_CLIP_VOLUME_MOBILE : PROXIMO_CLIP_VOLUME
}

/** iOS Safari ignores HTMLMediaElement.volume — route through a GainNode. */
function attachProximoClipVolume(video) {
  const target = getProximoClipVolume()
  // Keep element volume at 1 when Web Audio owns the mix so we don't double-duck.
  video.volume = 1
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) {
      video.volume = target
      return
    }
    proximoClipAudioCtx = new Ctx()
    const source = proximoClipAudioCtx.createMediaElementSource(video)
    proximoClipGain = proximoClipAudioCtx.createGain()
    proximoClipGain.gain.value = target
    source.connect(proximoClipGain)
    proximoClipGain.connect(proximoClipAudioCtx.destination)
  } catch (err) {
    console.warn('[title] video Web Audio volume unavailable:', err)
    video.volume = target
  }
}

function resumeProximoClipAudio() {
  if (!proximoClipAudioCtx) return
  if (proximoClipAudioCtx.state === 'suspended') {
    proximoClipAudioCtx.resume().catch(() => {})
  }
}

function endProximoClip() {
  proximoClipFinished = true
  removeProximoClipRetry()
  try {
    proximoClipGain?.disconnect()
    proximoClipAudioCtx?.close()
  } catch {
    // ignore teardown errors
  }
  proximoClipGain = null
  proximoClipAudioCtx = null
  proximoClipVideo?.remove()
  proximoClipVideo = null
}

/** Stop the title/loading Proximo clip once the arena is ready. */
export function stopProximoClip() {
  endProximoClip()
}

// autoplay with sound is blocked until a user activation. NOTE: on touch
// devices only pointerup/touchend/click/keydown count as activation —
// pointerdown does NOT, which is why retrying there froze the video on mobile
function onProximoClipRetry() {
  if (proximoClipFinished || !proximoClipVideo) {
    removeProximoClipRetry()
    return
  }
  tryPlayProximoClip()
}

function addProximoClipRetry() {
  if (proximoClipRetryAttached) return
  proximoClipRetryAttached = true
  window.addEventListener('click', onProximoClipRetry)
  window.addEventListener('touchend', onProximoClipRetry)
  window.addEventListener('keydown', onProximoClipRetry)
}

function removeProximoClipRetry() {
  if (!proximoClipRetryAttached) return
  proximoClipRetryAttached = false
  window.removeEventListener('click', onProximoClipRetry)
  window.removeEventListener('touchend', onProximoClipRetry)
  window.removeEventListener('keydown', onProximoClipRetry)
}

function tryPlayProximoClip() {
  const video = proximoClipVideo
  if (!video) return
  if (!video.paused) {
    removeProximoClipRetry()
    return
  }
  resumeProximoClipAudio()
  video
    .play()
    .then(() => {
      resumeProximoClipAudio()
      removeProximoClipRetry()
    })
    .catch(() => addProximoClipRetry())
}

function startProximoClip() {
  if (proximoClipFinished) return

  if (!proximoClipVideo) {
    const probe = document.createElement('video')
    // devices that can't decode the clip (e.g. iOS Safari without VP9/alpha
    // WebM support) would show a frozen empty box forever — skip entirely
    if (!probe.canPlayType('video/webm; codecs="vp9"')) {
      proximoClipFinished = true
      return
    }

    const video = probe
    video.src = ASSETS.proximoClip
    video.playsInline = true
    video.setAttribute('playsinline', '')
    video.preload = 'auto'
    video.crossOrigin = 'anonymous'
    attachProximoClipVolume(video)
    video.style.cssText = [
      'position: fixed',
      'left: calc(1rem + 50px)',
      'bottom: calc(1rem + 50px)',
      'width: min(30vw, 20rem)',
      'z-index: 10001',
      'pointer-events: none',
      'background: transparent',
      // stay invisible until playback actually starts so a blocked video
      // never sits frozen in the corner
      'visibility: hidden',
    ].join(';')
    video.addEventListener(
      'playing',
      () => {
        video.style.visibility = 'visible'
      },
      { once: true }
    )
    video.addEventListener('ended', endProximoClip, { once: true })
    video.addEventListener('error', endProximoClip, { once: true })

    let clappingPlayed = false
    video.addEventListener('timeupdate', () => {
      if (clappingPlayed || video.currentTime < CLAPPING_AT_SECONDS) return
      clappingPlayed = true
      const clapping = new Audio(ASSETS.clapping)
      clapping.play().catch(() => {})
    })
    document.body.appendChild(video)
    proximoClipVideo = video
  }

  tryPlayProximoClip()
}

export function TitleScreen({ onStart }) {
  const [name, setName] = useState(() => {
    try {
      return sessionStorage.getItem('proximo.playerName') || ''
    } catch {
      return ''
    }
  })
  const [scrollReady, setScrollReady] = useState(false)
  const [showTitle, setShowTitle] = useState(false)
  const titleMusicRef = useRef(null)
  const usernameRef = useRef(null)

  const trimmedName = name.trim()
  const canStart = trimmedName.length > 0

  useEffect(() => {
    // manages its own blocked-autoplay retries internally
    startProximoClip()
  }, [])

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
    prefetchGameAssets({ light: true })
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
    startProximoClip()

    // retry blocked autoplay on the first real user activation — on touch
    // devices pointerdown does not count, pointerup/keydown do
    const onFirstInteraction = () => {
      startMusic()
      startProximoClip()
      window.removeEventListener('pointerup', onFirstInteraction)
      window.removeEventListener('keydown', onFirstInteraction)
    }
    window.addEventListener('pointerup', onFirstInteraction)
    window.addEventListener('keydown', onFirstInteraction)

    usernameRef.current?.focus()

    return () => {
      window.removeEventListener('pointerup', onFirstInteraction)
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

    const playerName = trimmedName.slice(0, MAX_NAME_LENGTH)
    try {
      sessionStorage.setItem('proximo.playerName', playerName)
    } catch {
      // ignore quota / private mode
    }
    onStart({
      name: playerName,
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
        .title-layout {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 1.5rem;
          width: 100%;
          max-width: min(96vw, 52rem);
          padding: 1rem;
          box-sizing: border-box;
          flex-wrap: wrap;
        }
        .title-rankings-slot {
          flex: 0 1 18rem;
          order: 1;
        }
        .title-panel {
          position: relative;
          display: inline-block;
          max-width: min(92vw, 22rem);
          border: none;
          background: transparent;
          flex: 0 1 22rem;
          order: 2;
        }
        @media (max-width: 700px) {
          .title-layout {
            flex-direction: column;
            justify-content: flex-start;
            padding-top: 1.25rem;
            max-height: 100%;
            overflow: auto;
          }
          .title-rankings-slot {
            order: 2;
            width: 100%;
            max-width: 22rem;
          }
          .title-panel {
            order: 1;
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
        <h1 className='loading-heading'>Proximo</h1>
        <div className='loading-spinner' aria-hidden='true' />
      </div>

      {showTitle && (
        <div className='title-stage visible'>
          <img className='title-bg' src={ASSETS.bg} alt='' />
          <div className='title-overlay' />
          <div className='title-layout'>
            <div className='title-rankings-slot'>
              <TitleArenaRankings />
            </div>
            <form className='title-panel' onSubmit={handleSubmit}>
              <img className={`title-scroll${scrollReady ? ' ready' : ''}`} src={ASSETS.scroll} alt='' />
              <div className='title-panel-content'>
                <h1 className='title-heading'>Proximo</h1>
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
        </div>
      )}
    </div>
  )
}
