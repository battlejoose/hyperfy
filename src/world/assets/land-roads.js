var GRID_SIZE = 25
var PLOT_SIZE = 50
var ROAD_WIDTH = 5
var CELL_PITCH = PLOT_SIZE + ROAD_WIDTH
var HALF_GRID = (GRID_SIZE * CELL_PITCH) / 2
var GRID_SPAN = GRID_SIZE * CELL_PITCH
var parcels = props.parcels || {}

// Roads
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

// Signs
for (var plotId = 1; plotId <= GRID_SIZE * GRID_SIZE; plotId++) {
  var idx = plotId - 1
  var row = Math.floor(idx / GRID_SIZE)
  var col = idx % GRID_SIZE
  var cx = col * CELL_PITCH - HALF_GRID + CELL_PITCH / 2
  var cz = row * CELL_PITCH - HALF_GRID + CELL_PITCH / 2
  var sx = cx - PLOT_SIZE / 2 - ROAD_WIDTH / 2
  var sz = cz - PLOT_SIZE / 2 - ROAD_WIDTH / 2

  var parcel = parcels[String(plotId)]
  var isClaimed = !!(parcel && parcel.ownerId)

  var post = app.create('prim', {
    type: 'box',
    size: [0.15, 4, 0.15],
    color: isClaimed ? '#2d5a27' : '#cc3333',
    position: [sx, 2, sz],
    metalness: 0.1,
    roughness: 0.9,
  })
  app.add(post)

  var board = app.create('prim', {
    type: 'box',
    size: [7.5, 3.6, 0.2],
    color: isClaimed ? '#1a4a1a' : '#1a3a5c',
    position: [sx, 4.8, sz],
    metalness: 0.2,
    roughness: 0.8,
  })
  app.add(board)

  if (world.isClient) {
    var ui = app.create('ui', {
      width: 280,
      height: 140,
      size: 0.021,
      position: [sx, 4.8, sz + 0.12],
      billboard: 'none',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 10,
    })
    var title = app.create('uitext', {
      value: 'Lot #' + plotId,
      fontSize: 22,
      fontWeight: 700,
      color: 'white',
      textAlign: 'center',
      margin: [0, 0, 6, 0],
    })
    ui.add(title)

    if (isClaimed) {
      var ownerText = app.create('uitext', {
        value: parcel.ownerName || 'Unknown',
        fontSize: 15,
        color: '#aaffaa',
        textAlign: 'center',
      })
      ui.add(ownerText)
    } else {
      var availText = app.create('uitext', {
        value: 'Available',
        fontSize: 16,
        color: '#aaddff',
        textAlign: 'center',
      })
      ui.add(availText)
    }
    app.add(ui)

    if (!isClaimed) {
      var claimAct = app.create('action', {
        label: 'Claim Lot #' + plotId,
        position: [sx, 2, sz],
        distance: 8,
        duration: 0.5,
        onTrigger: (function(pid) {
          return function() { app.send('claim', { plotId: pid }) }
        })(plotId),
      })
      app.add(claimAct)
    }

    if (isClaimed && world.networkId === parcel.ownerId) {
      var unclaimAct = app.create('action', {
        label: 'Unclaim Lot #' + plotId,
        position: [sx, 2, sz],
        distance: 8,
        duration: 0.5,
        onTrigger: (function(pid) {
          return function() { app.send('unclaim', { plotId: pid }) }
        })(plotId),
      })
      app.add(unclaimAct)
    }
  }
}

if (world.isServer) {
  app.on('claim', function(data, networkId) {
    app.emit('landClaim', { plotId: data.plotId, playerId: networkId })
  })
  app.on('unclaim', function(data, networkId) {
    app.emit('landUnclaim', { plotId: data.plotId, playerId: networkId })
  })
}
