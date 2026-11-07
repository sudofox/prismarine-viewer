/* global THREE */

global.THREE = require('three')
const TWEEN = require('@tweenjs/tween.js')
require('three/examples/js/controls/OrbitControls')

const { Viewer, Entity } = require('../viewer')

const io = require('socket.io-client')
const socket = io({
  path: window.location.pathname + 'socket.io'
})

let firstPositionUpdate = true

const renderer = new THREE.WebGLRenderer()
renderer.setPixelRatio(window.devicePixelRatio || 1)
renderer.setSize(window.innerWidth, window.innerHeight)
document.body.appendChild(renderer.domElement)

const viewer = new Viewer(renderer)
let manualCamera = null
let targetOutline = null
let cameraFrameAt = performance.now()
function setManualCamera (value) {
  if (!value || value.type !== 'workman:camera' || value.version !== 1) return
  if (value.active && Number.isFinite(value.yaw) && Number.isFinite(value.pitch)) {
    if (!manualCamera) {
      manualCamera = { yaw: value.yaw, pitch: value.pitch, renderedYaw: viewer.camera.rotation.y, renderedPitch: viewer.camera.rotation.x }
      cameraFrameAt = performance.now()
    }
    manualCamera.yaw = value.yaw
    manualCamera.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, value.pitch))
  } else manualCamera = null
  const p = value.target
  if (p && [p.x, p.y, p.z].every(Number.isFinite)) {
    if (!targetOutline) {
      targetOutline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)), new THREE.LineBasicMaterial({ color: 0x111111 }))
      viewer.scene.add(targetOutline)
    }
    targetOutline.position.set(p.x + 0.5, p.y + 0.5, p.z + 0.5)
    targetOutline.visible = true
  } else if (targetOutline) targetOutline.visible = false
}
// Same-origin hosts can deliver mouse events directly, avoiding a queued iframe
// message and a second animation-frame wait. Other hosts retain the message bridge.
window.workmanViewer = { version: 1, setCamera: setManualCamera }
window.addEventListener('message', (event) => {
  if (event.source !== window.parent || event.origin !== window.location.origin) return
  setManualCamera(event.data)
})
window.parent.postMessage({ type: 'workman:viewer-ready', version: 1 }, window.location.origin)

let controls = new THREE.OrbitControls(viewer.camera, renderer.domElement)

function animate () {
  window.requestAnimationFrame(animate)
  if (controls) controls.update()
  viewer.update()
  if (manualCamera) {
    const now = performance.now()
    const dt = Math.max(0, Math.min(0.05, (now - cameraFrameAt) / 1000))
    cameraFrameAt = now
    // Frame-rate independent damping: short enough to track the mouse closely,
    // while filling the gaps between input events. Always turn across the short arc.
    const blend = 1 - Math.exp(-dt / 0.022)
    const delta = manualCamera.yaw - manualCamera.renderedYaw
    manualCamera.renderedYaw += Math.atan2(Math.sin(delta), Math.cos(delta)) * blend
    manualCamera.renderedPitch += (manualCamera.pitch - manualCamera.renderedPitch) * blend
    viewer.camera.rotation.set(manualCamera.renderedPitch, manualCamera.renderedYaw, 0, 'ZYX')
  }
  renderer.render(viewer.scene, viewer.camera)
}
animate()

window.addEventListener('resize', () => {
  viewer.camera.aspect = window.innerWidth / window.innerHeight
  viewer.camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

socket.on('version', (version) => {
  if (!viewer.setVersion(version)) {
    return false
  }

  firstPositionUpdate = true
  viewer.listen(socket)

  let botMesh
  socket.on('position', ({ pos, addMesh, yaw, pitch, eyeHeight }) => {
    if (yaw !== undefined && pitch !== undefined) {
      if (controls) {
        controls.dispose()
        controls = null
      }
      if (Number.isFinite(eyeHeight)) { viewer.playerHeight = eyeHeight; viewer.isSneaking = false }
      viewer.setFirstPersonCamera(pos, manualCamera ? manualCamera.renderedYaw : yaw, manualCamera ? manualCamera.renderedPitch : pitch)
      return
    }
    if (pos.y > 0 && firstPositionUpdate) {
      controls.target.set(pos.x, pos.y, pos.z)
      viewer.camera.position.set(pos.x, pos.y + 20, pos.z + 20)
      controls.update()
      firstPositionUpdate = false
    }
    if (addMesh) {
      if (!botMesh) {
        botMesh = new Entity('1.16.4', 'player', viewer.scene).mesh
        viewer.scene.add(botMesh)
      }
      new TWEEN.Tween(botMesh.position).to({ x: pos.x, y: pos.y, z: pos.z }, 50).start()

      const da = (yaw - botMesh.rotation.y) % (Math.PI * 2)
      const dy = 2 * da % (Math.PI * 2) - da
      new TWEEN.Tween(botMesh.rotation).to({ y: botMesh.rotation.y + dy }, 50).start()
    }
  })
})
