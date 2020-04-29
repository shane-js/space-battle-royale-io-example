

// 3rd
import io from 'socket.io-client';
import {Events, Vector, Body} from 'matter-js';
// 1st
import { pxm, mxp, unpackBinaryMsgPack, roundAndStripExtraZeros, roundAndStripVector, rad2deg, normalizeRad } from '../common/util';
import Simulation from '../common/simulation';
import Player from '../common/player';
import Bomb from '../common/bomb';
import Physics from '../common/physics';
import renderer from './renderer';
import sounds from './sounds';


// STATE


const state = {
  // these get assigned once client has received :init payload
  userId: null,
  render: null,
  simulation: null,
  // Pass into `render` when we need to remove a sprite
  // Remember to reset it after render.
  spritesToRemove: [],
  // list of [bomb] sent to render,
  // should be cleared after render since they're
  // in the renderers hands now
  detonatedBombs: [],
  // players killed this frame, will turn into explosions by
  // the render step
  killedPlayers: []
}


// SOCKET


const socket = window.location.hostname === 'localhost'
  ? io('http://localhost:1337')
  : io('http://localhost:1337')


// socket.on('open', ...)


socket.on(':init', async (data) => {
  data = unpackBinaryMsgPack(data);
  //console.log('[recv :init]', data)
  const {userId, map} = data
  state.userId = userId
  state.simulation = new Simulation(map)

  // The client can enable some optimizations
  // state.simulation.world.sleepMode = p2.World.BODY_SLEEPING
  // state.simulation.world.solver.tolerance = 1 //.001 // default: 0.0000001

  // TODO: I should just change this to renderer.init(simulation, ...)
  //       This is stupid
  state.render = await renderer.init({ x: map.width, y: map.height }, state.simulation.tilesize, state.simulation.collisionWallBodies, state.simulation.tiles, onStageClick)
  // Start update loop when user is ready
  setInterval(update, 1000 / 60)
  requestAnimationFrame(renderLoop)
  // Boot the client junkdrawer
  startClientStuff()
})


socket.on(':playerJoined', (data) => {
  data = unpackBinaryMsgPack(data);
  //console.log('[recv :playerJoined]', data);
  const player = Player.fromJson(data);
  state.simulation.addPlayer(player);
});


socket.on(':playerLeft', (userId) => {
  //console.log('[recv :playerLeft]', userId)
  state.simulation.removePlayer(userId)
  state.spritesToRemove.push(userId)
})


socket.on(':flagTaken', ([flagTeam, playerId]) => {
  //console.log('[recv :flagTaken', flagTeam, playerId)
  // update simulation
  if (flagTeam === 'RED') {
    state.simulation.redCarrier = playerId
  } else {
    state.simulation.blueCarrier = playerId
  }
  // check if we took it
  if (playerId === state.userId) {
    sounds.flagTakenBySelf.play()
  }
})


socket.on(':flagDropped', (flagTeam) => {
  //console.log('[recv :flagDropped', flagTeam)
  // update simulation
  if (flagTeam === 'RED') {
    state.simulation.redCarrier = null
  } else {
    state.simulation.blueCarrier = null
  }
})


socket.on(':flagCapture', (team) => {
  //console.log('[recv :flagCaptured', team)
  // update simulation
  // TODO: update score
  if (team === 'RED') {
    state.simulation.blueCarrier = null
  } else {
    state.simulation.redCarrier = null
  }
  // play sound
  if (!state.userId) return
  if (team === state.simulation.getPlayer(state.userId).team) {
    sounds.friendlyCapture.play()
  } else {
    sounds.enemyCapture.play()
  }
})


// Server is telling us that somebody else shot a bomb.
// We never get this for our *own* bombs.
//
// When we get this, add it to our simulation
socket.on(':bombShot', (packet) => {
  const data = unpackBinaryMsgPack(packet);
  const bomb = new Bomb(data.id, data.uId, data.p, data.v, data.a);
  state.simulation.addBomb(bomb)
})


// Server is broadcasting a bomb->player collision
// For now just remove the bomb from the sim.
// Reminder: bomb and victim are just json data, not instances
socket.on(':bombHit', (packet) => {
  //b = bomb, v = victim
  const data = unpackBinaryMsgPack(packet);
  //console.log('[recv :bombHit] bomb=', bomb, 'victim=', victim)
  state.simulation.removeBomb(data.b_id);
  detonateBombFx(data.b_id, data.b_p[0], data.b_p[0]);
  // Since bombs insta-gib players, create ship explosion here
  state.killedPlayers.push(state.simulation.getPlayer(data.v_id))
})


// Note: Since :player_left and :player_joined let the client
// keep their state up to date, the client just has to merge in the snapshot
// rather than check for simulation vs snapshot difference/orphans
//
// `items` is list of player json (Reminder: they aren't Player instances)
socket.on(':snapshot', (data) => {
    let unpackedData = unpackBinaryMsgPack(data);
    const snapshotData = unpackedData.s;
    const playerItems = snapshotData.p;
    const currentDeadPlayerMarkers = snapshotData.dPM;
    const weaponProjectileSnapshots =snapshotData.wP;
    let roundInfo = unpackedData.rI;
    let lastRoundRecap = unpackedData.rR;
    let updateSelf = unpackedData.uS;

    //update ui
    $('#roleDisplayText').text("You are " + roundInfo.pR + ".");
    $('#roundStateDescDisplayText').text(roundInfo.sD);
    $('#timeDisplayText').text(roundInfo.tD);
    $('#livingPlayersDisplayText').text(roundInfo.hA + " Humans Left Alive");
    if(lastRoundRecap != null){
      $('#roundRecapTitleDisplayText').text(lastRoundRecap.t);
      $('#roundRecapContainer').show();
    }else{
      $('#roundRecapContainer').hide();
    }

    for (const playerUpdate of playerItems) {
        const player = state.simulation.getPlayer(playerUpdate.id)
        player.isAlive = playerUpdate.iA;

        // after this point ignore our own data
        if (playerUpdate.id === state.userId && !updateSelf) continue;

        Body.setPosition(player.body, playerUpdate.p);
        Body.setVelocity(player.body, playerUpdate.v);
        Body.setAngle(player.body, playerUpdate.a);
    }

    //remove wep projs not included in this snapshot (i.e. not being rendered/displayed to this user)
    _.forOwn(state.simulation.bombs, (wepProj, wepProjId) => {
        if(_.findIndex(weaponProjectileSnapshots, wepProjSnap => { return wepProjSnap.id === wepProjId}) < 0){
            delete state.simulation.bombs[wepProjId];
        }
    });
    (weaponProjectileSnapshots || []).forEach(weaponProjectileUpdate => {
        const weaponProjctile = state.simulation.getBomb(weaponProjectileUpdate.id);
        if(weaponProjctile){
            Body.setPosition(weaponProjctile.body, weaponProjectileUpdate.p);
            Body.setVelocity(weaponProjctile.body, weaponProjectileUpdate.v);
            Body.setAngle(weaponProjctile.body, weaponProjectileUpdate.a);
        }
    });

    state.simulation.deadPlayerMarkers = currentDeadPlayerMarkers;
});


socket.on('disconnect', () => {
  console.log('disconnected...')
})


// KEYS


let keysDown = {
  up: false, down: false, left: false, right: false, bomb: false
}
window.onkeydown = function (e) {
  if (e.which === 38) { keysDown['up'] = true }
  if (e.which === 40) { keysDown['down'] = true }
  if (e.which === 37) { keysDown['left'] = true }
  if (e.which === 39) { keysDown['right'] = true }
  if (e.which === 70) { keysDown['bomb'] = true }
}
window.onkeyup = function (e) {
  if (e.which === 38) { keysDown['up'] = false }
  if (e.which === 40) { keysDown['down'] = false }
  if (e.which === 37) { keysDown['left'] = false }
  if (e.which === 39) { keysDown['right'] = false }
  if (e.which === 70) { keysDown['bomb'] = false }
}


// KEY HANDLERS


const wasDown = { up: false, down: false, left: false, right: false }

// Returns history item if key transitioned
function handleInput (key) {
  if (keysDown[key] && !wasDown[key]) {
    const historyItem = ['keydown', key]
    /* socket.send(JSON.stringify(historyItem))*/
    wasDown[key] = true
    // play engine sound if we're thrusting
    if (key === 'up' || key === 'down') {
      sounds.engine.play()
    }
    return historyItem
  } else if (!keysDown[key] && wasDown[key]) {
    const historyItem = ['keyup', key]
    /* socket.send(JSON.stringify(historyItem))*/
    wasDown[key] = false
    // Pause engine sound if we aren't holding down other thrust keys
    if (wasDown['up'] === false && wasDown['down'] === false) {
      sounds.engine.pause()
    }
    return historyItem
  }
}


// UPDATE LOOP




let lastUpdate

function update () {
  const now = performance.now()
  // Gather input this frame
  const turnItem = handleInput('left') || handleInput('right')
  const thrustItem = handleInput('up') || handleInput('down')
  // Apply local input
  state.simulation.enqueueInputs(
    state.userId,
    [turnItem, thrustItem].filter(Boolean)
  )
  // Shoot bomb
  if (keysDown.bomb) {
    // Spawn bomb in simulation
    const bomb = state.simulation.shootBomb(state.userId)
    // Tell server about bomb shot (if there was one)
    if (bomb) {
       sounds.bombShoot.play()
        const position = roundAndStripVector(bomb.body.position,2);
        const velocity = roundAndStripVector(bomb.body.startVelo, 2);
        socket.emit(':bombShot', {//tried msgpacking this but it doubled packet size
          id: bomb.id, // server uses client's id
          p: position, //position
          v: velocity, //velocity
            a: roundAndStripExtraZeros(bomb.body.angle, 2)
        });
    }
  }
  // Physics
  const deltaTime = lastUpdate ? (now - lastUpdate) / 1000 : 0
  // maxSubStep is 125 to ensure 1/60*maxSubStep is always less than our
  // max deltaTime which should be about 1.00 seconds (when user tabs
  // away from the game)
  state.simulation.step(deltaTime, 125)

  // Prepare for next frame
  lastUpdate = now
}


// EVENT HANDLER WHEN USER CLICKS THE STAGE


// Teleport current user to wherever they click (for debugging)
// yi = inverted y (pixi coords)
function onStageClick ({x, y: yi}) {
    if (!state.userId) return;
    // convert back to p2 coords
    const y = mxp(state.simulation.height) - yi;
    const player = state.simulation.getPlayer(state.userId);
    Body.setPosition(player.body, {x: pxm(x), y: pxm(y)});
    Body.setVelocity(player.body, Vector.mult(player.body.velocity, 0.60));
    //vec2.scale(player.body.velocity, player.body.velocity, 0.60);
}


// RENDER LOOP


let lastRender

// TODO: Relocate to the HUD update function
let fpsNode = null
$( document ).ready(function() {
    fpsNode = document.querySelector('#fps');
});
let sinceFpsUpdate = 0
let frameDurations = []

function renderLoop (now) {
  requestAnimationFrame(renderLoop)
  state.render(state.simulation, state.userId, state.spritesToRemove, state.detonatedBombs, state.killedPlayers)
  state.detonatedBombs = []
  state.spritesToRemove = []
  state.killedPlayers = []

  // Update FPS HUD once per second
  sinceFpsUpdate += lastRender ? (now - lastRender) : 0
  if (lastRender) {
    frameDurations.push(now - lastRender)
  }
  if (sinceFpsUpdate >= 1000) {
    const avgDuration = frameDurations.reduce((memo, n) => memo + n, 0) / frameDurations.length
    fpsNode.innerHTML = Math.round(1000 / avgDuration)
    sinceFpsUpdate = 0
    frameDurations = []
  }

  // Prepare for next frame
  lastRender = now
}


// Junk drawer of all the stuff we must setup after the
// simulation is loaded.
// TODO: Improve.


function startClientStuff () {
  // UPDATE TEMPORARY OVERLAY

  ;(function () {
        $( document ).ready(function() {
            const nodes = {
                angle: document.querySelector('#player-angle'),
                position: document.querySelector('#player-pos'),
                bodyAngle: document.querySelector('#body-angle'),
                speed: document.querySelector('#player-speed'),
                curEnergy: document.querySelector('#player-cur-energy'),
                maxEnergy: document.querySelector('#player-max-energy')
            };
            Events.on(state.simulation.engine, 'afterUpdate', function() {
                const player = state.simulation.getPlayer(state.userId);
                nodes.angle.innerHTML = rad2deg(normalizeRad(player.body.angle)).toFixed(2);
                nodes.bodyAngle.innerHTML = normalizeRad(player.body.angle).toFixed(2);
                nodes.position.innerHTML = player.body.position.x.toFixed(2) + ", " + player.body.position.y.toFixed(2);
                nodes.speed.innerHTML = Vector.magnitude(player.body.velocity).toFixed(2); //vec2.length(player.body.velocity).toFixed(2);
                nodes.curEnergy.innerHTML = player.curEnergy;
                nodes.maxEnergy.innerHTML = player.maxEnergy;
            });
        });
  })()


  // POST STEP
  Events.on(state.simulation.engine, 'afterUpdate', function() {
      const player = state.simulation.getPlayer(state.userId)

      // Move current user
      // Convert each input into force
      for (const [kind, key] of player.inputs) {
          if (kind === 'keydown') {
              if (key === 'up') {
                  Body.applyForce(player.body, player.body.position, Physics.getForceToMoveForward(player.body));
              } else if (key === 'down') {
                  Body.applyForce(player.body, player.body.position, Physics.getForceToMoveForward(player.body, true));
              }
              if (key === 'left') {
                  Body.setAngle(player.body, Physics.subtractRadWithAngleWrap(player.body.angle,player.turnSpeed));
                  //Body.rotate(player.body, -player.turnSpeed);
                  // Physics.rotateLeft(player.turnSpeed, player.body)
              } else if (key === 'right') {
                  Body.setAngle(player.body, Physics.addRadWithAngleWrap(player.body.angle,player.turnSpeed));
                  //Body.rotate(player.body, player.turnSpeed);
                  //Physics.rotateRight(player.turnSpeed, player.body)
              }
          } else if (kind === 'keyup' && (key === 'left' || key == 'right')) {
              Physics.zeroRotation(player.body)
          }
      }
      // Clear inputs for next frame
      player.inputs = []

      // Ensure user isn't going too fast
      player.enforceMaxSpeed()
  });

  // state.simulation.world.on('postStep', function () {
  //   const player = state.simulation.getPlayer(state.userId)
  //
  //   // Move current user
  //   // Convert each input into force
  //   for (const [kind, key] of player.inputs) {
  //     if (kind === 'keydown') {
  //       if (key === 'up') {
  //         Physics.thrust(player.thrust, player.body)
  //         player.updateCollisionMask()
  //       } else if (key === 'down') {
  //         Physics.thrust(-player.thrust, player.body)
  //         player.updateCollisionMask()
  //       }
  //       if (key === 'left') {
  //         Physics.rotateLeft(player.turnSpeed, player.body)
  //       } else if (key === 'right') {
  //         Physics.rotateRight(player.turnSpeed, player.body)
  //       }
  //     } else if (kind === 'keyup' && (key === 'left' || key == 'right')) {
  //       Physics.zeroRotation(player.body)
  //     }
  //   }
  //   // Clear inputs for next frame
  //   player.inputs = []
  //
  //   // Ensure user isn't going too fast
  //   player.enforceMaxSpeed()
  // })


  // HANDLE BOMB<->WALL CONTACT

  // state.simulation.on('bomb:hitPlayer', ({bomb, victim, shooter}) => {
  // })

    // !!!!!!!!!!!! commented out for migration to matterjs
  // state.simulation.on('bomb:hitWall', ({bomb, wallBody}) => {
  //   //console.log('bomb:hitWall. bomb:', bomb && bomb.id)
  //   if (bomb) {
  //     detonateBombFx(bomb.id, bomb.body.position[0], bomb.body.position[1])
  //     state.simulation.removeBomb(bomb.id)
  //   }
  // })


  // TRACK WHETHER PLAYER IS TOUCHING WALL
  //
  // If player it touching a wall, slow them down


  // state.simulation.world.on('beginContact', ({bodyA, bodyB}) => {
  //   if (bodyB.isPlayer && bodyA.isWall) {
  //     bodyB.damping = 0.85
  //     sounds.bounce.play()
  //   } else if (bodyA.isPlayer && bodyB.isWall) {
  //     bodyA.damping = 0.85
  //     sounds.bounce.play()
  //   }
  // })
  //
  // state.simulation.world.on('endContact', ({bodyA, bodyB}) => {
  //   if (bodyB.isPlayer && bodyA.isWall) {
  //     bodyB.damping = 0.1 // back to p2 default
  //   } else if (bodyA.isPlayer && bodyB.isWall) {
  //     bodyA.damping = 0.1 // back to p2 default
  //   }
  // })


  // BROADCAST POSITION -> SERVER

  ;(function () {
    const perSecond = 15

    function broadcastPosition () {
      const player = state.simulation.getPlayer(state.userId);
        //tried msgpack encoding here and it ended up multiplying in size by 2.5
        socket.emit(':position',[
                {x: roundAndStripExtraZeros(player.body.position.x, 2), y: roundAndStripExtraZeros(player.body.position.y, 2)},
            roundAndStripExtraZeros(player.body.angle, 2),
            {x: roundAndStripExtraZeros(player.body.velocity.x, 2), y: roundAndStripExtraZeros(player.body.velocity.y, 2)}
        ]);
    }

    setInterval(broadcastPosition, 1000 / perSecond)
  })()

}


// DEBUG: PRINT WINDOW VISIBILITY

;(function () {
  let isVisible = true
  document.addEventListener('visibilitychange', () => {
    isVisible = !isVisible
    //console.log('*************************** isVisible', isVisible)
    if (isVisible) {
      // Client is tabbing into game

      // Don't render explosions that accumulated while user was away
      // NOTE: We don't want to do this if these arrays are ever responsible
      //       for cleaning up state garbage.
      state.detonatedBombs = []
      state.killedPlayers = []
      // Avoid catchup
      lastUpdate = null
    } else {
      // Client is tabbing out of game

      // Clear keys pressed when user tabs out
      keysDown = { up: false, down: false, left: false, right: false, bomb: false }
    }
  })
})()


// TRACK IF WINDOW HAS FOCUS


;(function () {
  let isFocused = true
  window.onfocus = () => {
    isFocused = true
  }
  window.onblur = () => {
    isFocused = true
    // Clear keys pressed when game loses focus
    keysDown = { up: false, down: false, left: false, right: false, bomb: false }
  }
})()




function detonateBombFx (id, x, y) {
  state.detonatedBombs.push([id, x, y])
  state.spritesToRemove.push(id)
  sounds.bombExplode.play()
}
