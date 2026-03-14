const plotId = app.props.plotId || 0
const ownerId = app.props.ownerId || null
const ownerName = app.props.ownerName || null
const isClaimed = !!ownerId

const $post = app.create('prim', {
  type: 'box',
  size: [0.15, 4, 0.15],
  color: '#ff4444',
  position: [0, 2, 0],
  metalness: 0.1,
  roughness: 0.9,
  castShadow: true,
  receiveShadow: true,
})
app.add($post)

const $sign = app.create('prim', {
  type: 'box',
  size: [2.5, 1.4, 0.08],
  color: isClaimed ? '#2d5a27' : '#1a3a5c',
  position: [0, 3.8, 0.12],
  metalness: 0.2,
  roughness: 0.8,
  castShadow: true,
  receiveShadow: true,
})
app.add($sign)

if (world.isServer) {
  app.on('claim', function(data, networkId) {
    app.emit('landClaim', { plotId: data.plotId, playerId: networkId })
  })
  app.on('unclaim', function(data, networkId) {
    app.emit('landUnclaim', { plotId: data.plotId, playerId: networkId })
  })
}

if (world.isClient) {
  var $ui = app.create('ui', {
    width: 300,
    height: 200,
    size: 0.008,
    position: [0, 3.8, 0.16],
    billboard: 'none',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  })

  var $title = app.create('uitext', {
    value: 'Lot #' + plotId,
    fontSize: 24,
    fontWeight: 700,
    color: 'white',
    textAlign: 'center',
    margin: [0, 0, 8, 0],
  })
  $ui.add($title)

  if (isClaimed) {
    var $owner = app.create('uitext', {
      value: 'Owned by ' + ownerName,
      fontSize: 16,
      fontWeight: 400,
      color: '#aaffaa',
      textAlign: 'center',
    })
    $ui.add($owner)
  } else {
    var $status = app.create('uitext', {
      value: 'Available',
      fontSize: 18,
      fontWeight: 400,
      color: '#aaddff',
      textAlign: 'center',
    })
    $ui.add($status)
  }

  app.add($ui)

  if (!isClaimed) {
    var $claimAction = app.create('action', {
      label: 'Claim Lot',
      position: [0, 2, 0],
      distance: 8,
      duration: 0.5,
      onTrigger: function() {
        app.send('claim', { plotId: plotId })
      },
    })
    app.add($claimAction)
  }

  if (isClaimed && world.networkId === ownerId) {
    var $unclaimAction = app.create('action', {
      label: 'Unclaim Lot',
      position: [0, 2, 0],
      distance: 8,
      duration: 0.5,
      onTrigger: function() {
        app.send('unclaim', { plotId: plotId })
      },
    })
    app.add($unclaimAction)
  }
}
