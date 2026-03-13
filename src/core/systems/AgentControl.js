import { System } from './System'

/**
 * AgentControl System
 *
 * Runs on the browser client. Receives control commands from the
 * agent API (relayed via WebSocket) and simulates the corresponding
 * player inputs locally.
 */
export class AgentControl extends System {
  constructor(world) {
    super(world)
    this.walkTimer = null
  }

  handle(data) {
    switch (data.action) {
      case 'walk':
        return this.onWalk(data)
      case 'turn':
        return this.onTurn(data)
      case 'stop':
        return this.onStop()
      case 'chat':
        return this.onChat(data)
    }
  }

  onWalk({ duration }) {
    this.releaseWalk()
    this.world.controls.simulateButton('keyW', true)
    this.walkTimer = setTimeout(() => {
      this.world.controls.simulateButton('keyW', false)
      this.walkTimer = null
    }, duration * 1000)
  }

  onTurn({ direction, degrees }) {
    const player = this.world.entities.player
    if (!player) return

    const radians = (degrees * Math.PI) / 180
    player.cam.rotation.y += direction === 'left' ? radians : -radians

    const halfY = player.cam.rotation.y / 2
    player.base.quaternion.set(0, Math.sin(halfY), 0, Math.cos(halfY))
  }

  onStop() {
    this.releaseWalk()
  }

  onChat({ message }) {
    this.world.chat.send(message)
  }

  releaseWalk() {
    this.world.controls.simulateButton('keyW', false)
    if (this.walkTimer) {
      clearTimeout(this.walkTimer)
      this.walkTimer = null
    }
  }

  destroy() {
    this.releaseWalk()
  }
}
