const plotId = app.props.plotId
const ownerId = app.props.ownerId
const ownerName = app.props.ownerName

const isClaimed = !!ownerId

const POST_HEIGHT = 4
const POST_WIDTH = 0.15
const SIGN_WIDTH = 2.5
const SIGN_HEIGHT = 1.4
const SIGN_DEPTH = 0.08

const $post = app.create('prim', {
  type: 'box',
  size: [POST_WIDTH, POST_HEIGHT, POST_WIDTH],
  color: '#444444',
  position: [0, POST_HEIGHT / 2, 0],
  metalness: 0.4,
  roughness: 0.6,
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
  metalness: 0.2,
  roughness: 0.8,
  castShadow: true,
  receiveShadow: true,
})
app.add($sign)

const $ui = app.create('ui', {
  width: 300,
  height: 200,
  size: 0.008,
  position: [0, POST_HEIGHT - SIGN_HEIGHT / 2 + 0.1, SIGN_DEPTH + POST_WIDTH / 2 + 0.01],
  billboard: 'none',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 12,
})

const $title = app.create('uitext', {
  value: `Lot #${plotId}`,
  fontSize: 24,
  fontWeight: 700,
  color: 'white',
  textAlign: 'center',
  margin: [0, 0, 8, 0],
})
$ui.add($title)

if (isClaimed) {
  const $owner = app.create('uitext', {
    value: `Owned by ${ownerName}`,
    fontSize: 16,
    fontWeight: 400,
    color: '#aaffaa',
    textAlign: 'center',
  })
  $ui.add($owner)
} else {
  const $status = app.create('uitext', {
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
  const $claimAction = app.create('action', {
    label: 'Claim Lot',
    position: [0, POST_HEIGHT / 2, 0],
    distance: 8,
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
      distance: 8,
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
