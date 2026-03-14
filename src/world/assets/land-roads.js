var GRID_SIZE = 25
var PLOT_SIZE = 50
var ROAD_WIDTH = 5
var CELL_PITCH = PLOT_SIZE + ROAD_WIDTH
var HALF_GRID = (GRID_SIZE * CELL_PITCH) / 2
var GRID_SPAN = GRID_SIZE * CELL_PITCH

for (var i = 0; i < GRID_SIZE - 1; i++) {
  var offset = (i + 1) * CELL_PITCH - HALF_GRID - ROAD_WIDTH / 2

  var hRoad = app.create('prim', {
    type: 'box',
    size: [GRID_SPAN, 0.1, ROAD_WIDTH],
    color: '#222222',
    position: [0, 0.05, offset],
    castShadow: false,
    receiveShadow: true,
    physics: 'static',
    metalness: 0,
    roughness: 1,
  })
  app.add(hRoad)

  var vRoad = app.create('prim', {
    type: 'box',
    size: [ROAD_WIDTH, 0.1, GRID_SPAN],
    color: '#222222',
    position: [offset, 0.05, 0],
    castShadow: false,
    receiveShadow: true,
    physics: 'static',
    metalness: 0,
    roughness: 1,
  })
  app.add(vRoad)
}

for (var plotId = 1; plotId <= GRID_SIZE * GRID_SIZE; plotId++) {
  var idx = plotId - 1
  var row = Math.floor(idx / GRID_SIZE)
  var col = idx % GRID_SIZE
  var cx = col * CELL_PITCH - HALF_GRID + CELL_PITCH / 2
  var cz = row * CELL_PITCH - HALF_GRID + CELL_PITCH / 2
  var sx = cx - PLOT_SIZE / 2 - ROAD_WIDTH / 2
  var sz = cz - PLOT_SIZE / 2 - ROAD_WIDTH / 2

  var signPost = app.create('prim', {
    type: 'box',
    size: [0.15, 4, 0.15],
    color: '#ff0000',
    position: [sx, 2, sz],
  })
  app.add(signPost)

  var signBoard = app.create('prim', {
    type: 'box',
    size: [2, 1, 0.08],
    color: '#1a3a5c',
    position: [sx, 3.5, sz],
  })
  app.add(signBoard)
}
