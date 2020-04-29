

const p2 = require('p2')


// MATERIALS


exports.wall = new p2.Material()

exports.player = new p2.Material()


// CONTACT MATERIALS


exports.wallVsPlayer = new p2.ContactMaterial(exports.wall, exports.player, {
  restitution: 20,
  stiffness: Number.MAX_VALUE,
  friction: 0, // prevent wall from turning the ship
  frictionRelaxation: 0
})
