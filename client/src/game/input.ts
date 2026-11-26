// Keyboard + mouse state. Keys use `KeyboardEvent.code` (physical position),
// so WASD works on AZERTY/QWERTZ without a separate mapping.
import { Buttons, type BuyItem } from '../net/protocol'
import { unlockAudio } from './audio'
import { useSettings } from './settings'
import { useHud } from './store'
import { world } from './world'

const keys = new Set<string>()
let mouseDown = false
let zoomDown = false
/** One-tick weapon switch requested by Q or the mouse wheel. */
let pendingSlot = 0

const PITCH_LIMIT = 1.55

/** Buy menu entries, in order: number keys 1-6 pick them. */
export const BUY_MENU: { item: BuyItem; key: string }[] = [
  { item: { Weapon: 'HandCannon' }, key: '1' },
  { item: { Weapon: 'Smg' }, key: '2' },
  { item: { Weapon: 'Rifle' }, key: '3' },
  { item: { Weapon: 'Sniper' }, key: '4' },
  { item: 'Kevlar', key: '5' },
  { item: 'KevlarHelmet', key: '6' },
]

let buyHandler: ((item: BuyItem) => void) | null = null
/** Registered by the session (avoids an import cycle). */
export function onBuy(fn: (item: BuyItem) => void) {
  buyHandler = fn
}

function canvas() {
  return document.querySelector<HTMLCanvasElement>('.game canvas')
}

export function openBuyMenu(open: boolean) {
  const hud = useHud.getState()
  if (open && (!hud.canBuy || !hud.alive)) return
  useHud.setState({ buyOpen: open })
  // The menu frees the cursor so items can be clicked; closing grabs it back.
  if (open) document.exitPointerLock()
  else if (!document.pointerLockElement) canvas()?.requestPointerLock()
}

function onKeyDown(e: KeyboardEvent) {
  unlockAudio()
  // Alt would otherwise focus the browser menu bar on Windows.
  if (e.code === 'AltLeft' || e.code === 'AltRight') e.preventDefault()
  if (e.code === 'Tab') {
    e.preventDefault()
    useHud.setState({ showScores: true })
  }
  const hud = useHud.getState()
  if (hud.status === 'playing' && !e.repeat) {
    if (e.code === 'KeyB') {
      openBuyMenu(!hud.buyOpen)
      return
    }
    if (hud.buyOpen) {
      const entry = BUY_MENU.find((b) => `Digit${b.key}` === e.code)
      if (entry) buyHandler?.(entry.item)
      if (e.code === 'Escape') useHud.setState({ buyOpen: false })
      return
    }
  }
  if (!document.pointerLockElement) return
  if (e.code === 'KeyQ' && !e.repeat) {
    // Quick switch to the other slot.
    pendingSlot = world.arsenal?.active === 'Primary' ? 2 : 1
  }
  keys.add(e.code)
}

function onKeyUp(e: KeyboardEvent) {
  if (e.code === 'Tab') useHud.setState({ showScores: false })
  keys.delete(e.code)
}

function onMouseMove(e: MouseEvent) {
  if (!document.pointerLockElement) return
  // Sensitivity is in the familiar "cs-like" scale: 0.022 deg per count.
  // Scoped in, it scales with the zoom so aim feels the same.
  const { sensitivity, invertY } = useSettings.getState()
  const zoom = world.arsenal?.zoomed ? 0.4 : 1
  const radPerPx = (sensitivity * 0.022 * Math.PI * zoom) / 180
  world.yaw -= e.movementX * radPerPx
  world.pitch -= e.movementY * radPerPx * (invertY ? -1 : 1)
  world.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, world.pitch))
  world.yaw = ((world.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
}

function onMouseDown(e: MouseEvent) {
  unlockAudio()
  if (!document.pointerLockElement) return
  if (e.button === 0) mouseDown = true
  if (e.button === 2) zoomDown = true
}

function onMouseUp(e: MouseEvent) {
  if (e.button === 0) mouseDown = false
  if (e.button === 2) zoomDown = false
}

function onWheel(e: WheelEvent) {
  if (!document.pointerLockElement || e.deltaY === 0) return
  pendingSlot = world.arsenal?.active === 'Primary' ? 2 : 1
}

function onContextMenu(e: MouseEvent) {
  if (useHud.getState().status === 'playing') e.preventDefault()
}

function onLockChange() {
  const locked = !!document.pointerLockElement
  if (!locked) {
    keys.clear()
    mouseDown = false
    zoomDown = false
  }
  useHud.setState(locked ? { locked, settingsOpen: false, buyOpen: false } : { locked })
}

function onBlur() {
  keys.clear()
  mouseDown = false
  zoomDown = false
}

export function attachInput() {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mousedown', onMouseDown)
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('wheel', onWheel)
  window.addEventListener('contextmenu', onContextMenu)
  window.addEventListener('blur', onBlur)
  document.addEventListener('pointerlockchange', onLockChange)
  return () => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mousedown', onMouseDown)
    window.removeEventListener('mouseup', onMouseUp)
    window.removeEventListener('wheel', onWheel)
    window.removeEventListener('contextmenu', onContextMenu)
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
  if (zoomDown) buttons |= Buttons.ZOOM
  if (keys.has('KeyR')) buttons |= Buttons.RELOAD
  if (keys.has('ShiftLeft') || keys.has('ShiftRight')) buttons |= Buttons.SPRINT
  if (keys.has('AltLeft') || keys.has('AltRight')) buttons |= Buttons.WALK
  if (keys.has('KeyC')) buttons |= Buttons.CROUCH
  if (keys.has('KeyE')) buttons |= Buttons.USE
  if (keys.has('Digit1') || pendingSlot === 1) buttons |= Buttons.SLOT1
  if (keys.has('Digit2') || pendingSlot === 2) buttons |= Buttons.SLOT2
  pendingSlot = 0
  return { forward, right, buttons }
}
