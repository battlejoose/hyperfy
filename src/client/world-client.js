// import 'ses'
// import '../core/lockdown'
import * as THREE from 'three'
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { css } from '@firebolt-dev/css'

import { createClientWorld } from '../core/createClientWorld'
import { CoreUI } from './components/CoreUI'

export { System } from '../core/systems/System'

function Lobby({ onHumanLogin, onAgentPaired }) {
  const [pairKey, setPairKey] = useState(null)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)
  const pollRef = useRef(null)
  const keyRef = useRef(null)

  useEffect(() => {
    let cancelled = false

    async function fetchKey() {
      try {
        const resp = await fetch('/api/agent-pair')
        if (!resp.ok) throw new Error('Failed to get pairing key')
        const data = await resp.json()
        if (cancelled) return
        setPairKey(data.key)
        keyRef.current = data.key
      } catch (err) {
        if (!cancelled) setError(err.message)
      }
    }

    fetchKey()

    return () => {
      cancelled = true
      if (pollRef.current) clearInterval(pollRef.current)
      if (keyRef.current) {
        fetch(`/api/agent-pair/${keyRef.current}`, { method: 'DELETE' }).catch(() => {})
      }
    }
  }, [])

  useEffect(() => {
    if (!pairKey) return

    pollRef.current = setInterval(async () => {
      try {
        const resp = await fetch(`/api/agent-pair/${pairKey}/status`)
        if (!resp.ok) return
        const data = await resp.json()
        if (data.status === 'paired') {
          clearInterval(pollRef.current)
          pollRef.current = null
          keyRef.current = null
          onAgentPaired(pairKey, data.name, data.avatar)
        }
      } catch {
        // ignore polling errors
      }
    }, 1500)

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [pairKey])

  const handleCopy = useCallback(() => {
    if (!pairKey) return
    navigator.clipboard.writeText(pairKey).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [pairKey])

  const handleHumanLogin = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = null
    if (keyRef.current) {
      fetch(`/api/agent-pair/${keyRef.current}`, { method: 'DELETE' }).catch(() => {})
      keyRef.current = null
    }
    onHumanLogin()
  }, [onHumanLogin])

  return (
    <div
      css={css`
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #111;
        color: #eee;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        z-index: 9999;

        .lobby-card {
          background: #1a1a2e;
          border: 1px solid #333;
          border-radius: 16px;
          padding: 40px;
          max-width: 460px;
          width: 90%;
          text-align: center;
        }
        .lobby-title {
          font-size: 22px;
          font-weight: 600;
          margin-bottom: 12px;
        }
        .lobby-desc {
          font-size: 14px;
          color: #aaa;
          line-height: 1.5;
          margin-bottom: 28px;
        }
        .lobby-key-label {
          font-size: 12px;
          color: #888;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 8px;
        }
        .lobby-key-box {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          margin-bottom: 32px;
        }
        .lobby-key {
          font-family: 'SF Mono', 'Fira Code', monospace;
          font-size: 28px;
          font-weight: 700;
          letter-spacing: 3px;
          color: #7c5cfc;
          background: #0d0d1a;
          padding: 12px 24px;
          border-radius: 8px;
          border: 1px solid #333;
        }
        .lobby-copy-btn {
          background: #333;
          border: 1px solid #555;
          color: #ccc;
          padding: 10px 16px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 13px;
          transition: background 0.15s;
          &:hover {
            background: #444;
          }
        }
        .lobby-waiting {
          font-size: 13px;
          color: #666;
          margin-bottom: 28px;
        }
        .lobby-divider {
          border: none;
          border-top: 1px solid #333;
          margin: 0 0 24px 0;
        }
        .lobby-human-btn {
          background: #7c5cfc;
          border: none;
          color: white;
          padding: 14px 32px;
          border-radius: 10px;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s;
          &:hover {
            background: #6a4ae0;
          }
        }
        .lobby-error {
          color: #f66;
          font-size: 14px;
          margin-bottom: 16px;
        }
      `}
    >
      <div className='lobby-card'>
        <div className='lobby-title'>Hyperfy World</div>
        <div className='lobby-desc'>
          Connect an AI agent to this world using the API key below,
          or login as a human player.
        </div>

        {error && <div className='lobby-error'>{error}</div>}

        <div className='lobby-key-label'>Agent Pairing Key</div>
        <div className='lobby-key-box'>
          <div className='lobby-key'>{pairKey || '...'}</div>
          {pairKey && (
            <button className='lobby-copy-btn' onClick={handleCopy}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          )}
        </div>

        <div className='lobby-waiting'>Waiting for agent to connect...</div>

        <hr className='lobby-divider' />

        <button className='lobby-human-btn' onClick={handleHumanLogin}>
          Login as Human
        </button>
      </div>
    </div>
  )
}

export function Client({ wsUrl, onSetup }) {
  const viewportRef = useRef()
  const uiRef = useRef()
  const world = useMemo(() => createClientWorld(), [])
  const [mode, setMode] = useState('lobby')
  const [ui, setUI] = useState(world.ui.state)
  const connectRef = useRef(null)

  useEffect(() => {
    world.on('ui', setUI)
    return () => {
      world.off('ui', setUI)
    }
  }, [])

  useEffect(() => {
    if (mode !== 'game') return

    const init = async () => {
      const viewport = viewportRef.current
      const ui = uiRef.current
      const baseEnvironment = {
        model: '/base-environment.glb',
        bg: null,
        hdr: '/Clear_08_4pm_LDR.hdr',
        rotationY: 0,
        sunDirection: new THREE.Vector3(-1, -2, -2).normalize(),
        sunIntensity: 1,
        sunColor: 0xffffff,
        fogNear: null,
        fogFar: null,
        fogColor: null,
      }
      let resolvedWsUrl = wsUrl
      if (typeof resolvedWsUrl === 'function') {
        resolvedWsUrl = resolvedWsUrl()
        if (resolvedWsUrl instanceof Promise) resolvedWsUrl = await resolvedWsUrl
      }
      const config = { viewport, ui, wsUrl: resolvedWsUrl, baseEnvironment }
      const conn = connectRef.current
      if (conn?.agentKey) {
        config.agentKey = conn.agentKey
        config.name = conn.name
        config.avatar = conn.avatar
      }
      onSetup?.(world, config)
      world.init(config)
    }
    init()
  }, [mode])

  const handleHumanLogin = useCallback(() => {
    connectRef.current = null
    setMode('game')
  }, [])

  const handleAgentPaired = useCallback((agentKey, name, avatar) => {
    connectRef.current = { agentKey, name, avatar }
    setMode('game')
  }, [])

  return (
    <div
      className='App'
      css={css`
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 100vh;
        height: 100dvh;
        .App__viewport {
          position: absolute;
          inset: 0;
        }
        .App__ui {
          position: absolute;
          inset: 0;
          pointer-events: none;
          user-select: none;
          display: ${ui.visible ? 'block' : 'none'};
        }
      `}
    >
      <div className='App__viewport' ref={viewportRef}>
        <div className='App__ui' ref={uiRef}>
          {mode === 'game' && <CoreUI world={world} />}
        </div>
      </div>
      {mode === 'lobby' && (
        <Lobby onHumanLogin={handleHumanLogin} onAgentPaired={handleAgentPaired} />
      )}
    </div>
  )
}
