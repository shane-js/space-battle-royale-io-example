

// 3rd
const Matter = require('matter-js')
let Bodies = Matter.Bodies, Vector = Matter.Vector;
const p2 = require('p2');
const vec2 = p2.vec2
// 1st
const Physics = require('./physics')
const Uuid = require('./uuid')
const Group = require('./CollisionGroup')
const util = require('./util')
const { pxm } = util


module.exports = Bomb


function Bomb (id, userId, position, velocity, angle) {
  this.id = id;
  let collisionMask =  Group.WALL
                          | Group.Player.ANY
                          | Group.Filter.ANY;
  this.body = (() => {
      const body = new Matter.Bodies.circle(position.x, position.y, pxm(3),
          {   isSensor: true,
              angle: angle,
              density: 0.7,
              friction: 0,
              frictionStatic: 0,
              frictionAir: 0.03,
              collisionFilter: {category: Group.Weapon.ANY , mask: collisionMask} });
    body.isWeaponProjectile = true;
    body.projectileId = id;
    body.userId = userId;
    body.startVelo = velocity;
    return body
  })()
}


// Static


Bomb.fromJson = function (data) {
  return new Bomb(data.id, data.userId, data.position, data.velocity, data.angle)
};


Bomb.fromPlayer = function (player) {
  player.curEnergy -= player.bombCost;
  const id = Uuid.generate();
  const nose = Physics.nose(player.body);
  const position = {x: nose[0], y: nose[1]};
  let velocity = {x: 0, y: pxm(15)};
  velocity = Vector.rotate(velocity, -(player.body.angle));
  velocity = Vector.add(velocity, player.body.velocity);
  //vec2.rotate(velocity, vec2.fromValues(0, pxm(300)), -util.deg2rad(player.deg));
  //vec2.add(velocity, player.body.velocity, velocity);
  return new Bomb(id, player.id, position, velocity, player.body.angle)
};


// Instance


Bomb.prototype.toJson = function () {
  return {
        id: this.id,
        uId: this.userId, //userId
        p: {x: util.roundAndStripExtraZeros(this.body.position.x,2), y: util.roundAndStripExtraZeros(this.body.position.y,2)}, //position
        v: {x: util.roundAndStripExtraZeros(this.body.velocity.x,2), y: util.roundAndStripExtraZeros(this.body.velocity.y,2)}, //velocity
        a: this.body.angle //angle
  }
};
