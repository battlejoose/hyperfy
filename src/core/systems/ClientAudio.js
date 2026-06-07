import * as THREE from '../extras/three'

import { System } from './System'

const AMBIENT_WIND_SRC = 'asset://desertwind.mp3'
const AMBIENT_WIND_VOLUME = 0.5

const up = new THREE.Vector3(0, 1, 0)
const v1 = new THREE.Vector3()

export class ClientAudio extends System {
  constructor(world) {
    super(world)
    this.handles = new Set()
    this.ctx = new AudioContext() // new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.ctx.createGain()
    this.masterGain.connect(this.ctx.destination)
    this.groupGains = {
      music: this.ctx.createGain(),
      sfx: this.ctx.createGain(),
      voice: this.ctx.createGain(),
    }
    this.groupGains.music.gain.value = world.prefs.music
    this.groupGains.sfx.gain.value = world.prefs.sfx
    this.groupGains.voice.gain.value = world.prefs.voice
    this.groupGains.music.connect(this.masterGain)
    this.groupGains.sfx.connect(this.masterGain)
    this.groupGains.voice.connect(this.masterGain)
    this.listener = this.ctx.listener
    this.listener.positionX.value = 0
    this.listener.positionY.value = 0
    this.listener.positionZ.value = 0
    this.listener.forwardX.value = 0
    this.listener.forwardY.value = 0
    this.listener.forwardZ.value = -1
    this.listener.upX.value = 0
    this.listener.upY.value = 1
    this.listener.upZ.value = 0
    this.lastDelta = 0

    this.queue = []
    this.unlocked = this.ctx.state !== 'suspended'
    if (!this.unlocked) {
      this.setupUnlockListener()
    }
  }

  ready(fn) {
    if (this.unlocked) return fn()
    this.queue.push(fn)
  }

  setupUnlockListener() {
    const complete = () => {
      this.unlocked = true
      document.removeEventListener('click', unlock)
      document.removeEventListener('touchstart', unlock)
      document.removeEventListener('keydown', unlock)
      while (this.queue.length) {
        this.queue.pop()()
      }
      console.log('[audio] unlocked')
    }
    const unlock = async () => {
      try {
        await this.ctx.resume()
        if (this.ctx.state !== 'running') throw new Error('Audio still suspended')
        const video = document.createElement('video')
        video.playsInline = true
        video.muted = true
        video.src = '/tiny.mp4'
        video
          .play()
          .then(() => {
            video.pause()
            video.remove()
            console.log('[audio] video played')
          })
          .catch(err => {
            console.log('[audio] video failed')
          })
      } catch (err) {
        console.error(err)
      } finally {
        // either way, mark the system as unlocked
        complete()
      }
    }
    document.addEventListener('click', unlock)
    document.addEventListener('touchstart', unlock)
    document.addEventListener('keydown', unlock)
    console.log('[audio] suspended, waiting for interact...')
  }

  async init() {
    this.world.prefs.on('change', this.onPrefsChange)
    this.world.on('ready', this.startAmbientWind)
  }

  startAmbientWind = () => {
    if (this.ambientWindElem) return

    const url = this.world.resolveURL(AMBIENT_WIND_SRC)
    if (url.startsWith('asset://')) {
      console.error('[audio] ambient wind url not resolved')
      return
    }

    const elem = new Audio(url)
    elem.loop = true
    elem.crossOrigin = 'anonymous'

    const source = this.ctx.createMediaElementSource(elem)
    const gain = this.ctx.createGain()
    gain.gain.value = AMBIENT_WIND_VOLUME
    source.connect(gain)
    gain.connect(this.groupGains.music)

    this.ambientWindElem = elem
    this.ambientWindSource = source
    this.ambientWindGain = gain

    this.ready(() => {
      elem.play().catch(err => console.error('[audio] ambient wind failed:', err))
    })
  }

  lateUpdate(delta) {
    const target = this.world.rig
    const dir = v1.set(0, 0, -1).applyQuaternion(target.quaternion)
    if (this.listener.positionX) {
      // https://github.com/mrdoob/three.js/blob/master/src/audio/AudioListener.js
      // code path for Chrome (see three#14393)
      const endTime = this.ctx.currentTime + delta * 2
      this.listener.positionX.linearRampToValueAtTime(target.position.x, endTime)
      this.listener.positionY.linearRampToValueAtTime(target.position.y, endTime)
      this.listener.positionZ.linearRampToValueAtTime(target.position.z, endTime)
      this.listener.forwardX.linearRampToValueAtTime(dir.x, endTime)
      this.listener.forwardY.linearRampToValueAtTime(dir.y, endTime)
      this.listener.forwardZ.linearRampToValueAtTime(dir.z, endTime)
      this.listener.upX.linearRampToValueAtTime(up.x, endTime)
      this.listener.upY.linearRampToValueAtTime(up.y, endTime)
      this.listener.upZ.linearRampToValueAtTime(up.z, endTime)
    } else {
      this.listener.setPosition(target.position.x, target.position.y, target.position.z)
      this.listener.setOrientation(dir.x, dir.y, dir.z, up.x, up.y, up.z)
    }
    this.lastDelta = delta * 2
  }

  onPrefsChange = changes => {
    if (changes.music) {
      this.groupGains.music.gain.value = changes.music.value
    }
    if (changes.sfx) {
      this.groupGains.sfx.gain.value = changes.sfx.value
    }
    if (changes.voice) {
      this.groupGains.voice.gain.value = changes.voice.value
    }
  }

  destroy() {
    if (this.ambientWindElem) {
      this.ambientWindElem.pause()
      this.ambientWindElem.src = ''
      this.ambientWindElem = null
    }
    if (this.ambientWindSource) {
      this.ambientWindSource.disconnect()
      this.ambientWindSource = null
    }
    if (this.ambientWindGain) {
      this.ambientWindGain.disconnect()
      this.ambientWindGain = null
    }
    this.groupGains.music.disconnect()
    this.groupGains.sfx.disconnect()
    this.groupGains.voice.disconnect()
    this.masterGain.disconnect()
    this.ctx.close()
    this.handles.clear()
    this.queue = []
  }
}
