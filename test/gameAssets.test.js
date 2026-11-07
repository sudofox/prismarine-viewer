const setupGameAssets = require('../lib/gameAssets')

describe('embedded game asset routes', () => {
  const routes = new Map()
  beforeAll(() => setupGameAssets({ get: (route, handler) => routes.set(route, handler) }, '1.21.1'))
  function response () {
    const res = { sendStatus: jest.fn(), sendFile: jest.fn(), set: jest.fn() }
    res.set.mockReturnValue(res)
    return res
  }
  test('serves the matching item texture', () => {
    const res = response()
    routes.get('/workman/item/:name')({ params: { name: 'diamond_sword' } }, res)
    expect(res.sendFile).toHaveBeenCalledWith(expect.stringMatching(/1\.21\.1.*items.*diamond_sword\.png$/))
  })
  test('rejects arbitrary paths', () => {
    const res = response()
    routes.get('/workman/item/:name')({ params: { name: '../secret' } }, res)
    expect(res.sendStatus).toHaveBeenCalledWith(400)
    expect(res.sendFile).not.toHaveBeenCalled()
  })
  test('limits HUD assets to known icons', () => {
    const res = response()
    routes.get('/workman/gui/:name')({ params: { name: '../secret' } }, res)
    expect(res.sendStatus).toHaveBeenCalledWith(404)
    expect(res.sendFile).not.toHaveBeenCalled()
  })
  test('rejects invalid sound identifiers without fetching', async () => {
    const res = response()
    await routes.get('/workman/sound/:name')({ params: { name: 'https://example.test/' } }, res)
    expect(res.sendStatus).toHaveBeenCalledWith(400)
  })
})
