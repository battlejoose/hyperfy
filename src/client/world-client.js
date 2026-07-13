// import 'ses'
// import '../core/lockdown'
import * as THREE from 'three'
import { useEffect, useMemo, useRef, useState } from 'react'
import { css } from '@firebolt-dev/css'

import { createClientWorld } from '../core/createClientWorld'
import { CoreUI } from './components/CoreUI'
import { TitleScreen } from './components/TitleScreen'

export { System } from '../core/systems/System'

export function Client({ wsUrl, onSetup }) {
  const viewportRef = useRef()
  const uiRef = useRef()
  const world = useMemo(() => createClientWorld(), [])
  const [ui, setUI] = useState(world.ui.state)
  const [session, setSession] = useState(null)

  useEffect(() => {
    world.on('ui', setUI)
    return () => {
      world.off('ui', setUI)
    }
  }, [])

  useEffect(() => {
    if (!session) return

    const init = async () => {
      const viewport = viewportRef.current
      const ui = uiRef.current
      const baseEnvironment = {
        model: null,
        bg: null,
        hdr: null,
        rotationY: 0,
        sunDirection: new THREE.Vector3(-1, -2, -2).normalize(),
        sunIntensity: 2.2,
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
      const config = {
        viewport,
        ui,
        wsUrl: resolvedWsUrl,
        baseEnvironment,
        name: session.name,
        avatar: session.avatar,
      }
      onSetup?.(world, config)
      world.init(config)
    }
    init()
  }, [session])

  if (!session) {
    return <TitleScreen onStart={setSession} />
  }

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
          <CoreUI world={world} />
        </div>
      </div>
    </div>
  )
}
