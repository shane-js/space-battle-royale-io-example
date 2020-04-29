// Core
const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
// 3rd
const Server = require('socket.io')
const performance = { now: require('performance-now') };
const nodeStatic = require('node-static');
const msgpack = require("msgpack-lite");
const _ = require("lodash");
const Matter = require('matter-js')
const Body = Matter.Body;
const uuid = require("uuid");

// 1st
const socketioManager = require('./socketioManager.js');
const map1Json = require('../static/map1.json')
const tileset1Json = require('../static/tileset1.json')
const util = require('../common/util')
const { mxp, pxm } = util
const Simulation = require('../common/simulation');
const Player = require('../common/player');
const Bomb = require('../common/bomb');


// STATE


// Load map from file
// const mapFromFile = fs.readFileSync(path.join(__dirname, '../map2.txt'), 'utf8')
//   .split('\n')
//   .filter(Boolean);

const state = {
    simulation: Simulation.fromData(pxm(64), map1Json, tileset1Json, { isServer: true }),
    startTime: Date.now(),
    serverListeningToPlayerPositionUpdates: true
};


// HELPERS


const uid = (() => {
  let id = 0
  return () => ++id
})();


// HTTP SERVER


// const app = (function () {
//   // gzip regexp matches the response's content-type
//   const dist = new nodeStatic.Server('dist', { gzip: /\/(javascript|css)/ })
//   return http.createServer((req, res) => {
//     req.addListener('end', () => dist.serve(req, res)).resume()
//   })
// })();
var app = express();
app.use('/', express.static(path.join(__dirname, '/../static')));
app.use('/img', express.static(path.join(__dirname, '/../static/img')));
app.get('/', function(req, res) {
    res.sendFile(path.join(__dirname + '/../static/index.html'));
});

// start the server
const port = process.env.PORT || 1337;
const env = process.env.NODE_ENV || 'production';
let expressServer = app.listen(port, err => {
    if (err) {
        return console.error(err);
    }
    console.info(`Server running on http://localhost:${port} [${env}]`);
});
socketioManager.startSocketIO(expressServer);
const socketIoServer = socketioManager.getIO();

//const server = Server(app)

socketIoServer.on('connection', (socket) => {
  console.log('[connection] a client joined')
  socket.on('disconnect', () => onDisconnect(socket))
  // Create player
  const userId = uid()
  const player = state.simulation.createPlayer(userId, socket.id)
  socket.userId = userId
  socket.emit(':init', msgpack.encode({
      userId,
      // TODO: rofl clean this up
      map: {
            width: state.simulation.width,
            height: state.simulation.height,
            tilesize: state.simulation.tilesize,
            tiles: state.simulation.tiles.map((body) => Array.from(body.position)),
            redCarrier: state.simulation.redCarrier,
            blueCarrier: state.simulation.blueCarrier,
            collisionWalls: state.simulation.collisionWalls
      }
    })
  );
  // Broadcast the newcomer to everyone including newcomer
    socketIoServer.emit(':playerJoined', msgpack.encode(player.toJson()))
  // Tell newcomer of users already in the game
  for (const id in state.simulation.players) {
    socket.emit(':playerJoined', msgpack.encode(state.simulation.players[id].toJson()))
  }
  // Begin simulating the player (don't want newcomer to appear
  // in snapshots til everyone got :playerJoined to create his sprite)
  state.simulation.addPlayer(player);
  // Hook up game events
  socket.on(':position', (packet) => {
      if(state.serverListeningToPlayerPositionUpdates){ //don't take position updates during times we are teleporting
          onPosition(socket, packet)}
      }
    );
  socket.on(':bombShot', (bombInfo) => onBombShot(socket, bombInfo));
});


function onDisconnect (socket) {
  console.log('[disconnect] a client left')
  // if disconnecting player was a flag carrier, then reset the carrier
  if (socket.userId === state.simulation.redCarrier) {
    state.simulation.redCarrier = null
      socketIoServer.emit(':flagDropped', 'RED')
  } else if (socket.userId === state.simulation.blueCarrier) {
    state.simulation.blueCarrier = null
      socketIoServer.emit(':flagDropped', 'BLUE')
  }
  // drop player from simulation
  state.simulation.removePlayer(socket.userId)
  // tell everyone about it
    socketIoServer.emit(':playerLeft', socket.userId)
}


// Player is broadcasting their position
function onPosition (socket, [position, angle, velocity]) {
    const player = state.simulation.getPlayer(socket.userId)
    Body.setPosition(player.body, position);
    Body.setVelocity(player.body, velocity);
    Body.setAngle(player.body, angle);
}


// When a bomb is shot, add it to our simulation
function onBombShot (socket, bombShotData) {
  const id = bombShotData.id, position = bombShotData.p, velocity = bombShotData.v, angle = bombShotData.a;
  //console.log('[recv :bombShot]', id, socket.userId, position, velocity)
  // server uses client's bomb id (uuid)
  const bomb = new Bomb(id, socket.userId, position, velocity, angle)
  state.simulation.addBomb(bomb)
  // broadcast bombShot to all players except for the shooter
  socket.broadcast.emit(':bombShot', msgpack.encode({
    id,
      p: {x: util.roundAndStripExtraZeros(position.x, 2), y: util.roundAndStripExtraZeros(position.y, 2)}, //position
      v: {x: util.roundAndStripExtraZeros(velocity.x, 2), y: util.roundAndStripExtraZeros(velocity.y, 2)}, //velocity
    uId: socket.userId, //userId
      a: util.roundAndStripExtraZeros(angle,2)
  }));
}

function killPlayer (playerId){
    let player = players[playerId];
    if(!player) return;
    player.onDeath();
    const playerDeathMarker = {id: uuid.v4(), p: {x: player.body.position.x, y: player.body.position.y}}; //p = position
    if(state.simulation.deadPlayerMarkers && Array.isArray(state.simulation.deadPlayerMarkers)){
        state.simulation.deadPlayerMarkers.push(playerDeathMarker);
    }else{
        state.simulation.deadPlayerMarkers = [playerDeathMarker];
    }
};


////////////////////////////////////////////////////////////


// UPDATE LOOP
//
// The server does not simulate players. It just hard-codes their
// position/angle as players broadcast it.
//
// However, the server does simulate bomb velocity and is the authority
// on bomb<->player collision in which case it broadcasts a ':bombHit'
// packet. Players only broadcast :bombShot.


let lastTime

function update () {
  const now = performance.now()
  const deltaTime = lastTime ? (now - lastTime) / 1000 : 0
  state.simulation.step(deltaTime)
  lastTime = now
}

const updatesPerSecond = 60
setInterval(update, 1000 / updatesPerSecond)


// CHECK FOR BOMB COLLISION

////!!!!!!!!!!!!!!! commented out for switch to matterjs
// state.simulation.on('bomb:hitPlayer', ({bomb, victim, shooter}) => {
//   // we only remove bomb from simulation on server when it hits the playe.
//   // the client will wait til a wall hit or til server broadcasts player hit.
//   // TODO: Handle race condition on client: local wall hit vs server player hit
//   state.simulation.removeBomb(bomb.id);
//   const bombJson = bomb.toJson();
//   server.emit(':bombHit', msgpack.encode({
//       b_id: bombJson.id,
//       b_p: bombJson.p,
//       v_id: victim.id
//   }));
//   // TODO: In the future, affect victim.curEnergy by shooter.bombDamage
//   // and broadcast kills. but for now, bombs just insta-gib players
//   // so we can overload :bombHit.
// })
//
// state.simulation.on('bomb:hitWall', ({bomb, wallBody}) => {
//   if (bomb) state.simulation.removeBomb(bomb.id)
// })



// BROADCAST SNAPSHOT

// TODO: Only broadcast the *other* players to each user.
// Right now the client has to manually ignore their own data
// (since the client is the authority).
function broadcastSnapshot () {
  for(let connectedSocketId in socketIoServer.sockets.connected){
      let matchingPlayer = _.findKey(players,player => player.socketId === connectedSocketId);
      if(!matchingPlayer){
          return;
      }
      let socketToEmitTo = socketIoServer.sockets.connected[connectedSocketId];
      if(socketToEmitTo){
          socketToEmitTo.emit(':snapshot', msgpack.encode(
                {
                    s: state.simulation.toSnapshotForPlayerById(players[matchingPlayer].id), //snapshot
                    uS: !state.serverListeningToPlayerPositionUpdates,
                    rI: { //roundInfo
                        sD: currentRoundStateDesc, // sD = stateDescription display msg
                        hA: currentNumHumansAlive, // hA = currentNumHumansAlive
                        tD: displayTime, //tD = displayTime
                        pR: util.gameConstants.playerType_roleDescriptions[players[matchingPlayer].playerType]//pR = playerRole description
                    },
                    rR: lastRoundRecap //rR = roundRecap(null unless  in end of match stat screen) = {t = main title msg to display}
                }
            )
          )
      }

  }
}

const lobbyAreaPoints = [{x:20,y:240}, {x:38,y:216}, {x:15,y:216}, {x:16,y:220}, {x:30,y:225}, {x:13,y:230}, {x:37,y:233}, {x:40,y:246}, {x:9,y:247}, {x:42,y:237}];
const matchAreaPoints = [{x:70,y:230}];
const teleportPlayerBodyToAreaPoints= (playerBody, areaPoints) => {
    Body.setPosition(playerBody, _.sample(areaPoints));
};

const roundStatesConstants = {
    nullTimeDisplay: "~:~~",
    roundStateDesc_lobby: "Waiting For Players...",
    lobbyStartWaitTime: 10,
    roundStateDesc_starting: "Match starting...",
    matchDuration: 50,
    roundStateDesc_inProgress: "Match In Progress...",
    matchEndStatScreenTime:5,
    roundStateDesc_ended: "Match Over",
    roundFinishDesc_goodGuysWin: "Humans Are The Victors!",
    roundFinishDesc_badGuyWon: "The Intruder Won."
};
let displayTime = roundStatesConstants.nullTimeDisplay;
let currentRoundState = 0; //0 is lobby/pregame, 1 is starting the match, 2 is match is in progress, 3 is end of match stat screen
let currentRoundStateSecondsLeft = 0;
let currentRoundStateDesc = roundStatesConstants.roundStateDesc_lobby;
let currentNumHumansAlive = 100;
let lastRoundRecap = null;
let players = state.simulation.players;

(function () {
    const perSecond = 20;
    setInterval(broadcastSnapshot, 1000 / perSecond);

    setInterval( function() {
        currentNumHumansAlive = 0;
        _.forOwn(players, (player, key) => {
            if(player.isAlive && (player.playerType === util.gameConstants.playerType_human || player.playerType === util.gameConstants.playerType_peaceKeeper)){
                currentNumHumansAlive++;
            }
        } );

        if(currentRoundState === 0){ // !!!--- pregame lobby ---!!!
            //check if at least 3 players to start the match
            if(Object.keys(state.simulation.players).length >= 3){
                console.log("3 players now - should start match");
                currentRoundState = 1;
                currentRoundStateSecondsLeft = roundStatesConstants.lobbyStartWaitTime;
                currentRoundStateDesc = roundStatesConstants.roundStateDesc_starting;
            }
        }else if(currentRoundState === 1){ // !!!--- game starting ---!!!
            if(currentRoundStateSecondsLeft >= 1){
                currentRoundStateSecondsLeft--;
            }else{
                currentRoundState = 2;
                currentRoundStateSecondsLeft = roundStatesConstants.matchDuration;
                currentRoundStateDesc = roundStatesConstants.roundStateDesc_inProgress;

                //choose a random player to be the intruder and one to be the peace keeper
                let chosenPeaceKeeper = null;
                let chosenIntruder = null;
                while(chosenPeaceKeeper === chosenIntruder){
                    chosenPeaceKeeper = util.pickRandomPropFromObj(players);
                    chosenIntruder = util.pickRandomPropFromObj(players);
                }
                chosenPeaceKeeper.playerType = util.gameConstants.playerType_peaceKeeper;
                chosenIntruder.playerType = util.gameConstants.playerType_intruder;

                state.serverListeningToPlayerPositionUpdates = false; //stop listening to player positions for teleport purposes
                _.forOwn(players, (player, key) => {
                    teleportPlayerBodyToAreaPoints(player.body, matchAreaPoints);
                    player.isAlive = true;
                } );
                broadcastSnapshot();
                setTimeout(function() { state.serverListeningToPlayerPositionUpdates = true; }, 1000); //in 1 second listen to players position again
            }
            displayTime = util.gameStateTimeFormat(currentRoundStateSecondsLeft);
        }else if(currentRoundState === 2){ // !!!--- match in progress ---!!!
            if(currentRoundStateSecondsLeft >= 1){
                currentRoundStateSecondsLeft--;
            }else{
                currentRoundState = 3;
                currentRoundStateSecondsLeft = roundStatesConstants.matchEndStatScreenTime;
                currentRoundStateDesc = roundStatesConstants.roundStateDesc_ended;

                lastRoundRecap = {
                    t: currentNumHumansAlive >= 1 ? roundStatesConstants.roundFinishDesc_goodGuysWin : roundStatesConstants.roundFinishDesc_badGuyWon
                };

                state.serverListeningToPlayerPositionUpdates = false; //stop listening to player positions for teleport purposes
                _.forOwn(players, (player, playerId) => {
                    teleportPlayerBodyToAreaPoints(player.body, lobbyAreaPoints);
                    player.isAlive = false;
                } );
                broadcastSnapshot();
                setTimeout(function() { state.serverListeningToPlayerPositionUpdates = true; }, 1000); //in 1 second listen to players position again

            }
            displayTime = util.gameStateTimeFormat(currentRoundStateSecondsLeft);
        }else if(currentRoundState === 3){ // !!!--- match end stat screen ---!!!
            if(currentRoundStateSecondsLeft >= 1){
                currentRoundStateSecondsLeft--;
                displayTime = util.gameStateTimeFormat(currentRoundStateSecondsLeft);
            }else{
                currentRoundStateSecondsLeft = 0;
                currentRoundState = 0;
                displayTime = roundStatesConstants.nullTimeDisplay;
                currentRoundStateDesc = roundStatesConstants.roundStateDesc_lobby;
                lastRoundRecap = null;
                //reset all players to humans + make them not alive
                _.forOwn(players, (player, key) => {
                    player.playerType = util.gameConstants.playerType_human;
                } );
                //clear dead player markers
                state.simulation.deadPlayerMarkers = [];
            }
        }

        // game.clients.forEach( function( client ) {
        //     if( client.self !== undefined && !client.spectating ) {
        //         client.currentPackets.push( { type : "gameStateTick", obj : {state: currentRoundStateDesc, timeToDisplay: displayTime} } );
        //     }
        // } );
    }, 1000 );
})()


////////////////////////////////////////////////////////////

//
// app.listen(process.env.PORT || 3000, () => {
//   console.log('Listening on', app.address().port)
// })
