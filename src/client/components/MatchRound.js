import { useEffect, useRef, useState } from 'react'
import { css } from '@firebolt-dev/css'
import { createNode } from '../../core/extras/createNode'

const COUNTDOWN_SECONDS = 10
const HORNS_AT_SECONDS = 6
const SPEECH_TAIL_SECONDS = 5

const TIMER_CLAP_SRC = 'asset://timerclap.mp3'
const HORNS_SRC = 'asset://horns.mp3'
const PROXIMO_SPEECH_SRC = 'asset://proximospeech.mp3'

function playOneShot(world, src, { volume = 1, offset = 0, stopAfterMs = 8000 } = {}) {
  if (!world.audio) return

  const audio = createNode('audio', {
    src,
    volume,
    loop: false,
    group: 'sfx',
    spatial: false,
  })
  if (offset > 0) audio.currentTime = offset
  audio.activate({ world })
  audio.play()

  setTimeout(() => {
    if (audio.isPlaying) audio.stop()
    if (audio.active) audio.deactivate()
  }, stopAfterMs)
}

async function playProximoSpeechTail(world) {
  if (!world.audio || !world.loader) return

  let buffer = world.loader.get('audio', PROXIMO_SPEECH_SRC)
  if (!buffer) {
    try {
      buffer = await world.loader.load('audio', PROXIMO_SPEECH_SRC)
    } catch (err) {
      console.error('[MatchRound] failed to load proximospeech:', err)
      return
    }
  }

  const offset = Math.max(0, buffer.duration - SPEECH_TAIL_SECONDS)
  playOneShot(world, PROXIMO_SPEECH_SRC, {
    volume: 1,
    offset,
    stopAfterMs: (SPEECH_TAIL_SECONDS + 1) * 1000,
  })
}

// during the queue phase the long countdown lives in the arena scroll panel
// (PlayerQueueList). The final 10s (when a battle will actually start) is a
// full-screen overlay here, plus the battle-active banner once it begins.
export function MatchRound({ world }) {
  const [match, setMatch] = useState(() => world.network?.matchState)
  const [remaining, setRemaining] = useState(0)
  const firedSecondsRef = useRef(new Set())
  const endsAtRef = useRef(null)

  useEffect(() => {
    const onMatchState = data => setMatch(data)
    world.on('matchState', onMatchState)
    if (world.network?.matchState) {
      onMatchState(world.network.matchState)
    }
    return () => world.off('matchState', onMatchState)
  }, [world])

  useEffect(() => {
    if (match?.endsAt !== endsAtRef.current) {
      endsAtRef.current = match?.endsAt ?? null
      firedSecondsRef.current = new Set()
    }
  }, [match?.endsAt])

  useEffect(() => {
    if (!match) return
    const update = () => {
      if ((match.phase !== 'queue' && match.phase !== 'betting') || !match.endsAt) {
        setRemaining(0)
        return
      }
      setRemaining(Math.max(0, Math.ceil(match.endsAt - world.network.getTime())))
    }
    update()
    const id = setInterval(update, 100)
    return () => clearInterval(id)
  }, [match, world])

  const queuedCount = match?.queuedIds?.length ?? 0
  const countdownActive =
    (match?.phase === 'queue' || match?.phase === 'betting') &&
    queuedCount >= 2 &&
    remaining >= 1 &&
    remaining <= COUNTDOWN_SECONDS

  useEffect(() => {
    if (!countdownActive) return
    if (firedSecondsRef.current.has(remaining)) return
    firedSecondsRef.current.add(remaining)

    playOneShot(world, TIMER_CLAP_SRC, { volume: 1, stopAfterMs: 2000 })
    if (remaining === COUNTDOWN_SECONDS) {
      playProximoSpeechTail(world)
    }
    if (remaining === HORNS_AT_SECONDS) {
      playOneShot(world, HORNS_SRC, { volume: 1, stopAfterMs: 12000 })
    }
  }, [countdownActive, remaining, world])

  if (!match) return null

  const isTournamentMode = match.mode === 'tournament'
  const eventLabel = isTournamentMode ? 'Tournament' : 'Battle Royale'

  if (match.phase === 'battle' || match.phase === 'tournament') {
    return (
      <div
        css={css`
          position: absolute;
          top: 0.75rem;
          left: 50%;
          transform: translateX(-50%);
          pointer-events: none;
          z-index: 998;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.35rem;
          .match-battle-label {
            font-size: 1.35rem;
            font-weight: 800;
            letter-spacing: 0.1em;
            text-transform: uppercase;
            color: #fbbf24;
            text-shadow: 0 2px 8px rgba(0, 0, 0, 0.55);
          }
          .match-battle-alive {
            font-size: 0.95rem;
            font-weight: 600;
            color: rgba(255, 255, 255, 0.85);
            text-shadow: 0 2px 8px rgba(0, 0, 0, 0.55);
          }
        `}
      >
        <div className='match-battle-label'>{eventLabel}</div>
        <div className='match-battle-alive'>
          {match.phase === 'tournament'
            ? match.aliveCount === 2
              ? 'Duel in progress'
              : 'Bracket in progress'
            : `${match.aliveCount ?? 0} fighters remain`}
        </div>
      </div>
    )
  }

  if (!countdownActive) return null

  return (
    <div
      css={css`
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        z-index: 999;
        .br-countdown {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.75rem;
          animation: br-countdown-pop 0.35s ease-out;
        }
        .br-countdown-label {
          font-size: clamp(0.85rem, 2.5vw, 1.15rem);
          font-weight: 700;
          letter-spacing: 0.28em;
          text-transform: uppercase;
          color: rgba(251, 191, 36, 0.92);
          text-shadow: 0 2px 12px rgba(0, 0, 0, 0.7);
        }
        .br-countdown-num {
          font-size: clamp(6rem, 22vw, 12rem);
          font-weight: 900;
          line-height: 0.9;
          color: #fff8e7;
          text-shadow:
            0 0 40px rgba(251, 191, 36, 0.45),
            0 8px 28px rgba(0, 0, 0, 0.75);
        }
        @keyframes br-countdown-pop {
          from {
            transform: scale(1.18);
            opacity: 0.35;
          }
          to {
            transform: scale(1);
            opacity: 1;
          }
        }
      `}
      key={remaining}
    >
      <div className='br-countdown'>
        <div className='br-countdown-label'>{isTournamentMode ? 'Tournament begins' : 'Battle begins'}</div>
        <div className='br-countdown-num'>{remaining}</div>
      </div>
    </div>
  )
}
