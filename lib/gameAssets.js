// Read-only asset routes shared by embedded viewers. Assets stay version-specific.
const fs = require('fs')
const path = require('path')
const os = require('os')
const { createHash } = require('crypto')
const indexes = new Map()
const pending = new Map()
const publicRoot = path.resolve(__dirname, '../public/textures')
const cacheRoot = path.join(os.tmpdir(), 'prismarine-viewer-game-assets')

async function json (url) {
  const host = new URL(url).hostname
  if (!['piston-meta.mojang.com', 'launchermeta.mojang.com'].includes(host)) throw new Error('Invalid asset metadata host')
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error('Asset metadata unavailable')
  return response.json()
}
function once (key, load) {
  if (!pending.has(key)) pending.set(key, load().catch(error => { pending.delete(key); throw error }))
  return pending.get(key)
}
async function soundIndex (version) {
  return once('index:' + version, async () => {
    const manifest = await json('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')
    const release = manifest.versions.find(entry => entry.id === version)
    if (!release) throw new Error('Unsupported sound version')
    const info = await json(release.url)
    return (await json(info.assetIndex.url)).objects
  })
}
async function asset (hash) {
  if (!/^[0-9a-f]{40}$/.test(hash)) throw new Error('Invalid asset hash')
  return once(hash, async () => {
    const filename = path.join(cacheRoot, hash)
    if (fs.existsSync(filename)) return fs.promises.readFile(filename)
    const response = await fetch(`https://resources.download.minecraft.net/${hash.slice(0, 2)}/${hash}`, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error('Sound unavailable')
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > 8 * 1024 * 1024 || createHash('sha1').update(bytes).digest('hex') !== hash) throw new Error('Invalid sound asset')
    await fs.promises.mkdir(cacheRoot, { recursive: true })
    await fs.promises.writeFile(filename, bytes)
    return bytes
  })
}
function texture (version, name) {
  if (!indexes.has(version)) {
    let directory = path.join(publicRoot, version)
    if (!fs.existsSync(path.join(directory, 'items_textures.json'))) {
      try { directory = require('minecraft-assets')(version).directory } catch { return null }
    }
    const entries = JSON.parse(fs.readFileSync(path.join(directory, 'items_textures.json'), 'utf8'))
    indexes.set(version, { directory, entries: new Map(entries.map(entry => [entry.name, entry.texture])) })
  }
  const { directory, entries } = indexes.get(version)
  const namePath = entries.get(name)
  if (!namePath) return null
  // The assets index uses singular namespace paths; the package stores plural directories.
  const relative = namePath.replace(/^minecraft:/, '').replace(/^item\//, 'items/').replace(/^block\//, 'blocks/') + '.png'
  const resolved = path.resolve(directory, relative)
  return resolved.startsWith(path.resolve(directory) + path.sep) && fs.existsSync(resolved) ? resolved : null
}
module.exports = function setupGameAssets (app, version, prefix = '') {
  app.get(prefix + '/workman/item/:name', (req, res) => {
    if (!/^[a-z0-9_]{1,128}$/.test(req.params.name)) return res.sendStatus(400)
    const filename = texture(version, req.params.name)
    if (!filename) return res.sendStatus(404)
    res.set('Cache-Control', 'private, max-age=86400').sendFile(filename)
  })
  app.get(prefix + '/workman/gui/:name', (req, res) => {
    const names = { heart_full: 'heart/full', heart_half: 'heart/half', heart_empty: 'heart/container', food_full: 'food_full', food_half: 'food_half', food_empty: 'food_empty', armor_full: 'armor_full', armor_half: 'armor_half', armor_empty: 'armor_empty', air_full: 'air', air_half: 'air', air_empty: 'air_bursting' }
    const name = names[req.params.name]
    if (!name) return res.sendStatus(404)
    texture(version, 'stone')
    const directory = indexes.get(version)?.directory
    if (!directory) return res.sendStatus(404)
    const filename = path.join(directory, 'gui/sprites/hud', name + '.png')
    if (!fs.existsSync(filename)) return res.sendStatus(404)
    res.set('Cache-Control', 'private, max-age=86400').sendFile(filename)
  })
  app.get(prefix + '/workman/sound/:name', async (req, res) => {
    const name = req.params.name.replace(/^minecraft:/, '')
    if (!/^[a-z0-9_.]{1,160}$/.test(name)) return res.sendStatus(400)
    try {
      const index = await soundIndex(version)
      const definitions = index['minecraft/sounds.json']
      if (!definitions) return res.sendStatus(204)
      const events = JSON.parse((await asset(definitions.hash)).toString('utf8'))
      let event = events[name]
      // Event aliases can reference another sound event.
      let choice
      for (let depth = 0; depth < 5 && event; depth++) {
        choice = event.sounds[Math.floor(Math.random() * event.sounds.length)]
        if (typeof choice === 'object' && choice.type === 'event') event = events[choice.name]
        else break
      }
      const sound = typeof choice === 'string' ? choice : choice?.name
      const entry = index[`minecraft/sounds/${sound}.ogg`]
      if (!entry) return res.sendStatus(204)
      res.type('audio/ogg').set('Cache-Control', 'private, max-age=3600').send(await asset(entry.hash))
    } catch { res.sendStatus(204) }
  })
}
