

// Native
const assert = require('assert')
// 3rd
const Matter = require('matter-js')
const _ = require('lodash')
const uuid = require('uuid');
// 1st
const util = require('./util')
const { pxm, mxp } = util
const Physics = require('./physics')
const Player = require('./player')
const Bomb = require('./bomb')
const Material = require('./material')
const Group = require('./CollisionGroup')


module.exports = Simulation

let Engine = Matter.Engine,
    Events = Matter.Events,
    World = Matter.World,
    Body = Matter.Body,
    Bodies = Matter.Bodies,
    Composite = Matter.Composite,
    Vector = Matter.Vector;

// create engine
let engine = Engine.create(),
    world = engine.world,
    simulationIsOnServer = false,
    simulationInstance = null;

//initial world tweaks
world.gravity.x = 0;
world.gravity.y = 0;

// HELPERS

function makeWall (id, x, y, width, height) {
  const body = new Bodies.rectangle(pxm(x),pxm(y),pxm(width),pxm(height), { isStatic: true, restitution:0.8, collisionFilter: {category: Group.WALL , mask: Group.Player.ANY | Group.Weapon.ANY} });
  //const shape = new p2.Box({width: width, height: height});
  // shape.material = Material.wall;
  // shape.collisionGroup = Group.WALL;
  // shape.collisionMask = Group.Player.ANY | Group.Weapon.ANY;
  body.isWall = true;
  return body
}

// SIMULATION
function Simulation ({
    width, height, tiles, tilesize, collisionWalls,
    // array of [x, y] spawn points
    redSpawns = [], blueSpawns = [],
    // these are optional
    redCarrier = null, blueCarrier = null,
    bounded = false,
    isServer = false
  }) {
    this.isServer = isServer;
    simulationIsOnServer = isServer;
    // units are in meters
    this.width = width;
    this.height = height;
    //world.bounds = {min: {x:0, y:0}, max: {x:util.pxm(width), y: util.pxm(height)}} commented out because this was breaking wall collisions on the edge of the world bounds
    this.tilesize = tilesize;
    this.world = (function () {
      return world
    })()
    this.engine = (function () {
        return engine
    })()
    this.players = Object.create(null); // mapping of userId -> Player
    this.bombs = Object.create(null); // mapping of userId -> Bomb
    // WALLS
    this.collisionWalls = collisionWalls; //for sending to client
    this.collisionWallBodies = [];
    //this.collisionWallBodies.push(new Bodies.rectangle(50,50,30,30, { isStatic: true, restitution:0.8, collisionFilter: {category: Group.WALL , mask: Group.Player.ANY | Group.Weapon.ANY, group: 0} }))
    (collisionWalls || []).forEach(collisionWall => {
       this.collisionWallBodies.push(makeWall(collisionWall.id, util.roundAndStripExtraZeros(collisionWall.position.x,2), util.roundAndStripExtraZeros(collisionWall.position.y,2), collisionWall.width, collisionWall.height));
    });
    World.add(world, this.collisionWallBodies);
    this.deadPlayerMarkers = [];
    // TILES
    this.tiles = tiles.map(([x, y]) => makeWall(tilesize, tilesize, x, y))
    this.tiles.forEach((body) => this.world.addBody(body))
    // SPAWNS
    this.redSpawns = redSpawns
    this.blueSpawns = blueSpawns
    this.redCarrier = redCarrier  // player id that is carrying red flag
    this.blueCarrier = blueCarrier  // player id that is carrying blue flag
    // MATERIALS
   //this.world.addContactMaterial(Material.wallVsPlayer);

    // EVENTS (sim must be an event emitter and have .world populated)
    if(this.isServer){
        attachEvents.call(this);
    }
    simulationInstance = this;
}

//
// Simulation.prototype = _.create(p2.EventEmitter.prototype, {
//   'constructor': Simulation
// })


// This method should be used to init a Player instance since
// it assigns the team and sets the position based on simulation state.
//
// Returns Player
Simulation.prototype.createPlayer = function (id, socketId) {
  assert(Number.isInteger(id));

  let position;
  // 15 is the ship's hitbox radius to avoid spawning player on edge
  const y = util.randInt(15, this.height - 30);
  let x = util.randInt(this.width / 2, this.width - 15);

  position = {x: x, y: y};

  // Face the player towards a direction
  const angle = Math.random()*Math.PI*2

  return new Player(id, position, angle, socketId)
};


// Adds player to the simulation. Must call this after creating a player.
Simulation.prototype.addPlayer = function (player) {
    assert(player);
    World.add(world, [player.body]);
    this.players[player.id] = player;
};


Simulation.prototype.getPlayer = function (id) {
  assert(id);
  return this.players[id];
};


Simulation.prototype.getBomb = function (id) {
  assert(id);
  return this.bombs[id];
};


Simulation.prototype.addBomb = function (bomb) {
    assert(bomb);
    let initVelo = bomb.body.startVelo || {x: 0 , y: 0};
    Body.setVelocity(bomb.body, initVelo);
    Body.applyForce(bomb.body, bomb.body.position, Physics.getForceToMoveForward(bomb.body));
    World.add(world, bomb.body);
    this.bombs[bomb.id] = bomb;
};


Simulation.prototype.removePlayer = function (id) {
  assert(Number.isInteger(id));
  let matchingPlayer = this.players[id];
  if(matchingPlayer){
      Matter.Composite.remove(world, matchingPlayer.body);
      delete this.players[id];
  }
};


Simulation.prototype.removeBomb = function (id) {
    assert(id);
    let matchingBomb = this.bombs[id];
    if(matchingBomb){
        Composite.remove(world, matchingBomb.body);
        delete this.bombs[id];
    }
};


Simulation.prototype.playerCount = function () {
  return Object.keys(this.players).length;
};

// returns a mapping of team color to array of players
// { 'RED': [], 'BLUE', [] }
Simulation.prototype.getTeams = function () {
  return Object.assign(
    { RED: [], BLUE: [] },
    _.groupBy(_.values(this.players), 'team')
  )
};


Simulation.prototype.enqueueInput = function (userId, [kind, key]) {
  assert(Number.isInteger(userId));
  assert(typeof kind === 'string');
  assert(typeof key === 'string');
  const player = this.getPlayer(userId);
  player.keysDown[key] = kind === 'keydown';
  player.inputs.push([kind, key]);
};


// Creates bomb for player and adds it to simulation
//
// Returns Bomb if the player was able to shoot. null means
// they had insufficient cooldown.
Simulation.prototype.shootBomb = function (userId) {
      assert(Number.isInteger(userId));
      const player = this.getPlayer(userId);
      // check cooldown
      if (Date.now() - player.lastBombAt < 1000) return;
      // check energy
      if (player.curEnergy - player.bombCost < 0) return;
      const bomb = Bomb.fromPlayer(player);
      this.bombs[bomb.id] = bomb;
      Body.setVelocity(bomb.body, bomb.body.startVelo);
      World.add(world, bomb.body);
      // update cooldown
      player.lastBombAt = Date.now();
      return bomb;
};


////////////////////////////////////////////////////////////


const timeStep = 1 / 60

Simulation.prototype.step = function (deltaTime, maxSubSteps) {
    Engine.update(engine, deltaTime)
    //this.world.step(timeStep, deltaTime, maxSubSteps || 10);

    for (const id in this.players) {
        const player = this.players[id];
        // After the step, enforce player angles
        //player.updateDeg();
        // Recharge player energy
        player.rechargeEnergy(deltaTime)
      };

    _.forOwn(this.bombs, (bomb, key) => {
        if(Vector.magnitude(bomb.body.velocity) < .2){ //if the weapon has basically stopped moving remove it from the world
            this.removeBomb(bomb.id);
        }
     });
};


Simulation.prototype.enqueueInputs = function (userId, inputs) {
  const player = this.players[userId]
  // Update player's keysDown map and enqueue new inputs
  for (const [kind, key] of inputs) {
    player.inputs.push([kind, key]);
    player.keysDown[key] = kind === 'keydown'
  }
  // If player is still holding a key, enqueue the input for this frame
  if (player.keysDown.up) {
    player.inputs.push(['keydown', 'up']);
  } else if (player.keysDown.down) {
    player.inputs.push(['keydown', 'down']);
  }
  if (player.keysDown.left) {
    player.inputs.push(['keydown', 'left']);
  } else if (player.keysDown.right) {
    player.inputs.push(['keydown', 'right']);
  }
  if (player.keysDown.bomb) {
    player.inputs.push(['keydown', 'bomb']);
  }
};


// A snapshot is the list of players so that each client can
// draw the other players on their screen.
//
// TODO: Delta compression
Simulation.prototype.toSnapshot = function () {
  const snapshot = [];
  for (const id in this.players) {
      snapshot.push(this.players[id].toJson());
  }
  return snapshot;
};


Simulation.prototype.toSnapshotForPlayerById = function (playerIdToGetSnapshotFor) {
    let thisPlayer = this.players[playerIdToGetSnapshotFor];
    if(!thisPlayer){
        return;
    }
    const snapshot = {p:[], dPM:[], wP:[]}; //p: players, dPM: deadPlayerMarkers, wP: weapon projectiles
    //players
    for (const id in this.players) {
        if(id == playerIdToGetSnapshotFor){
            //include automatically for self
            snapshot.p.push(this.players[id].toJson());
            continue;
        }
        let otherPlayer = this.players[id];
        let distanceBetween = util.distanceBetweenTwoPositions(thisPlayer.body.position, otherPlayer.body.position);
        if(distanceBetween < 75 ){ //think it should be 100 in reality
            snapshot.p.push(otherPlayer.toJson());
        }
    }
    //weapon projectiles
    _.forOwn(this.bombs, (bomb,bombId) => {
        if(bomb.userId == playerIdToGetSnapshotFor){
            //include automatically for self
            snapshot.wP.push(bomb.toJson());
            return;
        }
        let distanceBetween = util.distanceBetweenTwoPositions(thisPlayer.body.position, bomb.body.position);
        if(distanceBetween < 75 ){ //think it should be 100 in reality
            snapshot.wP.push(bomb.toJson());
        }
    });
    //dead player markers
    (this.deadPlayerMarkers || []).forEach(deadPlayerMarker => {
        let distanceBetween = util.distanceBetweenTwoPositions(thisPlayer.body.position, deadPlayerMarker.p);
        if(distanceBetween < 75 ){ //think it should be 100 in reality
            snapshot.dPM.push(deadPlayerMarker);
        }
    });

    return snapshot
};


// STATIC
Simulation.fromData = function (tilesize, mapData, tilesetData, opts = {}) {
  // size of game world
  const width = mapData.width * tilesize;
  const height = mapData.height * tilesize;
  let tiles = [];
  let redSpawns = [];
  let blueSpawns = [];

  let collisionWalls = [];
  (mapData.layers || []).forEach(layer => {
      for(let mapTileRowIndex = 0; mapTileRowIndex < mapData.height; mapTileRowIndex++){
          for(let mapTileColIndex = 0; mapTileColIndex < mapData.width; mapTileColIndex++){
            let currentTileIndex = 0;
            currentTileIndex += mapTileColIndex;
            if(mapTileRowIndex !== 0){
              currentTileIndex = currentTileIndex + (mapTileRowIndex * mapData.width);
            }
            let tileIdInLayer = layer.data[currentTileIndex];
            const adjustedTileIndex = (tileIdInLayer - 1);
            const matchingTileSetRecord = (tilesetData.tiles || [])[adjustedTileIndex];
            if(matchingTileSetRecord && matchingTileSetRecord.objectgroup && matchingTileSetRecord.objectgroup.objects && matchingTileSetRecord.objectgroup.objects.length > 0){
                matchingTileSetRecord.objectgroup.objects.forEach(tileCollisionObject => {
                    const collisionWallPosX = tileCollisionObject.x + (mapData.tilewidth * .5) + (mapTileColIndex * mapData.tilewidth); //adjust for this tiles actual position
                    const collisionWallPosY = (mapData.height * mapData.tileheight) - (tileCollisionObject.y + (mapData.tileheight * .5) + (mapTileRowIndex * mapData.tileheight)); //adjust for this tiles actual position, from top of map height for y
                    let collisionWall = {id:tileCollisionObject.id, position:{x:collisionWallPosX, y:collisionWallPosY}, width:tileCollisionObject.width, height:tileCollisionObject.height};
                    collisionWalls.push(collisionWall);
                });
            }

          }
      }
  });

  // Print stats
  console.log('== Initializing map ==')
  console.log('- width: %s px', mxp(width))
  console.log('- height:%s px', mxp(height))
  console.log('- redSpawns: %s', redSpawns.length)
  console.log('- blueSpawns: %s', blueSpawns.length)
  return new Simulation(Object.assign({}, {
    width, height, tiles, tilesize, collisionWalls,
    redSpawns, blueSpawns
  }, opts))
};


//
// HOOK UP EVENTS (an experimental effort to begin deduping logic)
//
// Emitted for server:
// - flag:beginContact ({player, flagTeam})
//   - flag:take ({player, flagTeam})
//   - flag:capture ({player, flagTeam})
//
// - bomb:hitPlayer {victim, shooter, bomb}
// - bomb:hitWall {bomb, wallBody}


// Right now the server/client are responsible for updating the simulation
// via these hooks (like removing entities from the simulation post-
// collision). Not sure if it's the best way but lets me diverge server/client
// in rather straightforward way.


function attachEvents () {
    //!!!!!!!!!!!!! collision checks !!!!!!!!!!!!!!!//
    const isSelfWeaponCollision = (bodyA, bodyB) => {
        let aBCheck = (bodyA.isPlayer && bodyB.isWeaponProjectile) && (bodyA.id === bodyB.userId);
        let bACheck = (bodyB.isPlayer && bodyA.isWeaponProjectile) && (bodyB.id === bodyA.userId);
        return aBCheck || bACheck;
    };
    const isOtherPlayerWeaponCollision = (bodyA, bodyB) => {
        let aBCheck = (bodyA.isPlayer && bodyB.isWeaponProjectile) && (bodyA.id !== bodyB.userId);
        let bACheck = (bodyB.isPlayer && bodyA.isWeaponProjectile) && (bodyB.id !== bodyA.userId);
        return aBCheck || bACheck;
    };

    Events.on(engine, 'collisionStart', function(event) {
        event.pairs.forEach(collisionPair => {
            //remove weapons colliding with their owners (person who shot them)
            if(collisionPair){
                let {bodyA,bodyB} = collisionPair
                if(isSelfWeaponCollision(bodyA, bodyB)){
                    collisionPair.isActive = false; //console.log("collision canceled")
                }
                if(isOtherPlayerWeaponCollision(bodyA,bodyB)){
                    let playerIdHit = null;
                    let projectileIdToDestroy = null;
                    if(bodyA.isWeaponProjectile){
                        playerIdHit = bodyB.id;
                        projectileIdToDestroy = bodyA.projectileId;
                    }else{
                        playerIdHit = bodyA.id;
                        projectileIdToDestroy = bodyB.projectileId;
                    }
                    if(!projectileIdToDestroy || !playerIdHit) return;
                    let player = simulationInstance.players[playerIdHit];
                    if(!player) return;
                    //is player alive? if so valid hit
                    if(player.isAlive){
                        simulationInstance.removeBomb(projectileIdToDestroy); //console.log("you done shot someone else!");
                        player.onDeath();
                        simulationInstance.deadPlayerMarkers.push({id: uuid.v4(), p: {x: player.body.position.x, y: player.body.position.y}});
                    }

                }
            }
        })
    });
}
