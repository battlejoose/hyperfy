export function cls(...args) {
  let str = ''
  for (const arg of args) {
    if (typeof arg === 'string') {
      str += ' ' + arg
    } else if (typeof arg === 'object') {
      for (const key in arg) {
        const value = arg[key]
        if (value) str += ' ' + key
      }
    }
  }
  return str
}

// export const isTouch = !!navigator.userAgent.match(/OculusBrowser|iPhone|iPad|iPod|Android/i)

// if at least two indicators point to touch, consider it primarily touch-based:
const isBrowser = typeof window !== 'undefined'
const coarse = isBrowser && window.matchMedia('(pointer: coarse)').matches
const noHover = isBrowser && window.matchMedia('(hover: none)').matches
const hasTouch = isBrowser && navigator.maxTouchPoints > 0
export const isTouch = isBrowser && ((coarse && hasTouch) || (noHover && hasTouch))
