
// 3rd
const Matter = require('matter-js')
let Body = Matter.Body, Vector = Matter.Vector;
const faker = require('faker')
// 1st
const Material = require('./material')
const Group = require('./CollisionGroup')
const util = require('./util')
const { pxm } = util


module.exports = Player


function Player (id, position, angle, socketId) {
  this.id = id;
  this.socketId = socketId;
  // TODO: Hook up uname
  this.uname = faker.internet.userName().slice(0, 14);
  this.isAlive = false;
  this.playerType = util.gameConstants.playerType_human;
  this.lastBombAt = 0;  // millisecond timestamp since last bomb shot
  this.bombCost = 1000;
  this.maxEnergy = 1500;
  this.curEnergy = this.maxEnergy;
  // Per seconds
  this.maxSpeed = .25;// speed is a persecond measurement
  this.energyPerSecond = 500;
  this.turnSpeed = Math.PI/60; // rad per second
  this.thrust =  pxm(200);
  // The player's clamped angle in degrees. Use this for game logic,
  // like when calculating the trajectory of the bomb they're shooting.
  this.deg = util.rad2deg(angle || 0);
  const baseCollisionMask = Group.Flag.ANY
                          | Group.WALL
                          | Group.Weapon.ANY
                          | Group.Filter.ANY;
  this.body = (() => {
    const body = new Matter.Bodies.circle(position.x, position.y, pxm(25),
        {
            angle: angle || 0,
            friction: 0,
            frictionStatic: 0,
            frictionAir: 0.05,
            density: 0.003333,
            collisionFilter: {category: Group.Player.ANY , mask: baseCollisionMask}
        });
    body.isPlayer = true;
    body.id = id;
    // shape.collisionGroup = Group.Player.ANY;
    // shape._baseCollisionMask = baseCollisionMask;
    // shape.collisionMask = baseCollisionMask;
    // shape.material = Material.player;
    return body
  })()
  // INPUTS
  this.keysDown = { left: false, right: false, up: false, down: false };
  this.inputs = [];
}


// Static


Player.fromJson = function (data) {
  const player = new Player(data.id, data.p, data.a);
  player.uname = data.u;
  return player
}


// Instance


Player.prototype.toJson = function () {
  return {
      id: this.id,
      u: this.uname, //username
      p: {x: util.roundAndStripExtraZeros(this.body.position.x, 2), y:util.roundAndStripExtraZeros(this.body.position.y, 2)}, //position
      v: {x: util.roundAndStripExtraZeros(this.body.velocity.x, 2), y: util.roundAndStripExtraZeros(this.body.velocity.y, 2)}, //velocity
      a: util.roundAndStripExtraZeros(this.body.angle, 2), //angle
      iA: this.isAlive //self-explanatory but iA = isAlive

  }
};


// Clamps the player's angle to 9-degree intervals
Player.prototype.updateDeg = function () {
  this.deg = util.rad2deg(util.clampRad(this.body.angle));
};


// Clamps player's speed to their maximum
Player.prototype.enforceMaxSpeed = function () {
  const len = Vector.magnitude(this.body.velocity);
  // const len = vec2.length(this.body.velocity);
  if (len > this.maxSpeed) {
    Body.setVelocity(this.body, Vector.mult(this.body.velocity, (this.maxSpeed / len)));
    //vec2.scale(this.body.velocity, this.body.velocity, this.maxSpeed / len);
  }
};


Player.prototype.rechargeEnergy = function (deltaTime) {
  if (this.curEnergy === this.maxEnergy) return
  this.curEnergy = Math.min(
    this.maxEnergy,
    Math.round(this.curEnergy + this.energyPerSecond * deltaTime)
  );
};

Player.prototype.onDeath = function(){
  this.isAlive = false;
};


// Run this after velocity change to allow diode collisions
Player.prototype.updateCollisionMask = function () {
  ///!!!!! commented out for migration to matterjs
  //this.body.shapes[0].collisionMask = this.body.shapes[0]._baseCollisionMask | Group.velocityToDiodeMask(this.body.velocity)
};
