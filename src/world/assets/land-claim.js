const plotId = app.props.plotId
const ownerId = app.props.ownerId
const ownerName = app.props.ownerName

const isClaimed = !!ownerId

const POST_HEIGHT = 2
const POST_WIDTH = 0.1
const SIGN_WIDTH = 1.6
const SIGN_HEIGHT = 0.8
const SIGN_DEPTH = 0.06

const $post = app.create('prim', {
  type: 'box',
  size: [POST_WIDTH, POST_HEIGHT, POST_WIDTH],
  color: '#666666',
  position: [0, POST_HEIGHT / 2, 0],
  metalness: 0.6,
  roughness: 0.4,
  castShadow: true,
  receiveShadow: true,
  physics: 'static',
})
app.add($post)

const $sign = app.create('prim', {
  type: 'box',
  size: [SIGN_WIDTH, SIGN_HEIGHT, SIGN_DEPTH],
  color: isClaimed ? '#2d5a27' : '#1a3a5c',
  position: [0, POST_HEIGHT - SIGN_HEIGHT / 2 + 0.1, SIGN_DEPTH / 2 + POST_WIDTH / 2],
  metalness: 0.3,
  roughness: 0.7,
  castShadow: true,
  receiveShadow: true,
})
app.add($sign)

const $ui = app.create('ui', {
  width: 200,
  height: 140,
  size: 0.007,
  position: [0, POST_HEIGHT - SIGN_HEIGHT / 2 + 0.1, SIGN_DEPTH + POST_WIDTH / 2 + 0.01],
  billboard: 'none',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 8,
})

const $title = app.create('uitext', {
  value: `Lot #${plotId}`,
  fontSize: 18,
  fontWeight: 700,
  color: 'white',
  textAlign: 'center',
  margin: [0, 0, 6, 0],
})
$ui.add($title)

if (isClaimed) {
  const $owner = app.create('uitext', {
    value: `Owned by ${ownerName}`,
    fontSize: 12,
    fontWeight: 400,
    color: '#aaffaa',
    textAlign: 'center',
  })
  $ui.add($owner)
} else {
  const $status = app.create('uitext', {
    value: 'Available',
    fontSize: 13,
    fontWeight: 400,
    color: '#aaddff',
    textAlign: 'center',
  })
  $ui.add($status)
}

app.add($ui)

if (!isClaimed) {
  const $claimAction = app.create('action', {
    label: 'Claim Lot',
    position: [0, POST_HEIGHT / 2, 0],
    distance: 5,
    duration: 0.5,
    onTrigger: () => {
      app.send('claim', { plotId })
    },
  })
  app.add($claimAction)
}

if (isClaimed && world.isClient) {
  const localId = world.networkId
  if (localId === ownerId) {
    const $unclaimAction = app.create('action', {
      label: 'Unclaim Lot',
      position: [0, POST_HEIGHT / 2, 0],
      distance: 5,
      duration: 0.5,
      onTrigger: () => {
        app.send('unclaim', { plotId })
      },
    })
    app.add($unclaimAction)
  }
}

if (world.isServer) {
  app.on('claim', (data, networkId) => {
    app.emit('landClaim', { plotId: data.plotId, playerId: networkId })
  })
  app.on('unclaim', (data, networkId) => {
    app.emit('landUnclaim', { plotId: data.plotId, playerId: networkId })
  })
}
