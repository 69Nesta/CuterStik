// Keyboard + mouse state. Keys use `KeyboardEvent.code` (physical position),
// so WASD works on AZERTY/QWERTZ without a separate mapping.
import { Buttons } from '../net/protocol'
import { useHud } from './store'
import { world } from './world'

const keys = new Set<string>()
let mouseDown = false

const PITCH_LIMIT = 1.55

function onKeyDown(e: KeyboardEvent) {
  // Alt would otherwise focus the browser menu bar on Windows.
  if (e.code === 'AltLeft' || e.code === 'AltRight') e.preventDefault()
  if (e.code === 'Tab') {
    e.preventDefault()
    useHud.setState({ showScores: true })
  }
  if (!document.pointerLockElement) return
  keys.add(e.code)
}

function onKeyUp(e: KeyboardEvent) {
  if (e.code === 'Tab') useHud.setState({ showScores: false })
  keys.delete(e.code)
}

function onMouseMove(e: MouseEvent) {
  if (!document.pointerLockElement) return
  // Sensitivity is in the familiar "cs-like" scale: 0.022 deg per count.
  const radPerPx = (useHud.getState().sensitivity * 0.022 * Math.PI) / 180
  world.yaw -= e.movementX * radPerPx
  world.pitch -= e.movementY * radPerPx
  world.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, world.pitch))
  world.yaw = ((world.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
}

function onMouseDown(e: MouseEvent) {
  if (e.button === 0 && document.pointerLockElement) mouseDown = true
}

function onMouseUp(e: MouseEvent) {
  if (e.button === 0) mouseDown = false
}

function onLockChange() {
  const locked = !!document.pointerLockElement
  if (!locked) {
    keys.clear()
    mouseDown = false
  }
  useHud.setState({ locked })
}

function onBlur() {
  keys.clear()
  mouseDown = false
}

export function attachInput() {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mousedown', onMouseDown)
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('blur', onBlur)
  document.addEventListener('pointerlockchange', onLockChange)
  return () => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mousedown', onMouseDown)
    window.removeEventListener('mouseup', onMouseUp)
    window.removeEventListener('blur', onBlur)
    document.removeEventListener('pointerlockchange', onLockChange)
    onBlur()
  }
}

export function sampleInput() {
  const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0)
  const right = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0)
  let buttons = 0
  if (keys.has('Space')) buttons |= Buttons.JUMP
  if (mouseDown) buttons |= Buttons.FIRE
  if (keys.has('KeyR')) buttons |= Buttons.RELOAD
  if (keys.has('ShiftLeft') || keys.has('ShiftRight')) buttons |= Buttons.SPRINT
  if (keys.has('AltLeft') || keys.has('AltRight')) buttons |= Buttons.WALK
  if (keys.has('KeyC')) buttons |= Buttons.SLIDE
  return { forward, right, buttons }
}
