const GRID_SIZE = 25
const PLOT_SIZE = 50
const ROAD_WIDTH = 5
const CELL_PITCH = PLOT_SIZE + ROAD_WIDTH
const HALF_GRID = (GRID_SIZE * CELL_PITCH) / 2
const GRID_SPAN = GRID_SIZE * CELL_PITCH

for (let i = 0; i < GRID_SIZE - 1; i++) {
  const offset = (i + 1) * CELL_PITCH - HALF_GRID - ROAD_WIDTH / 2

  const hRoad = app.create('prim', {
    type: 'box',
    size: [GRID_SPAN, 0.3, ROAD_WIDTH],
    color: '#222222',
    position: [0, 0.15, offset],
    castShadow: false,
    receiveShadow: true,
    physics: 'static',
    metalness: 0,
    roughness: 1,
  })
  app.add(hRoad)

  const vRoad = app.create('prim', {
    type: 'box',
    size: [ROAD_WIDTH, 0.3, GRID_SPAN],
    color: '#222222',
    position: [offset, 0.15, 0],
    castShadow: false,
    receiveShadow: true,
    physics: 'static',
    metalness: 0,
    roughness: 1,
  })
  app.add(vRoad)
}
