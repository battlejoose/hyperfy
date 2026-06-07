import { useEffect, useState } from 'react'
import { css } from '@firebolt-dev/css'
import { ControlPriorities } from '../../core/extras/ControlPriorities'
import { getScoreboardPlayers } from '../../core/extras/scoreboardUtils'
import { ScoreboardPanel } from './ScoreboardPanel'

export function Scoreboard({ world }) {
  const [rows, setRows] = useState([])
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onScoreboard = data => {
      setRows(getScoreboardPlayers(data))
    }
    world.on('scoreboard', onScoreboard)
    if (world.network?.scoreboard) {
      onScoreboard(world.network.scoreboard)
    }
    return () => {
      world.off('scoreboard', onScoreboard)
    }
  }, [world])

  useEffect(() => {
    const control = world.controls.bind({ priority: ControlPriorities.CORE_UI })
    control.backquote.onPress = () => setVisible(true)
    control.backquote.onRelease = () => setVisible(false)
    return () => control.release()
  }, [world])

  if (!visible) return null

  return (
    <div
      css={css`
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        z-index: 1000;
      `}
    >
      <ScoreboardPanel rows={rows} />
    </div>
  )
}
