

// Collision groups
let collisionGroupBits = [0x0001, 0x0002, 0x0004, 0x0008, 0x0016, 0x0032, 0x0064, 0x0128, 0x0256, 0x0512, 0x1024];




// exports.Player = {}
// exports.Player.RED = Math.pow(2, 0)
// exports.Player.BLUE = Math.pow(2, 1)
// exports.Player.ANY = exports.Player.RED | exports.Player.BLUE
exports.Player = {};
exports.Player.ANY = collisionGroupBits[0];

// exports.Bomb = {}
// exports.Bomb.RED = Math.pow(2, 2)
// exports.Bomb.BLUE = Math.pow(2, 3)
// exports.Bomb.ANY = exports.Bomb.RED | exports.Bomb.BLUE
exports.Weapon = {};
exports.Weapon.ANY = collisionGroupBits[1];


exports.Flag = {}
exports.Flag.RED = collisionGroupBits[2]
exports.Flag.BLUE = collisionGroupBits[3]
exports.Flag.ANY = exports.Flag.RED | exports.Flag.BLUE

// exports.Filter = {}
// exports.Filter.RED = Math.pow(2, 6)
// exports.Filter.BLUE = Math.pow(2, 7)
// exports.Filter.ANY = exports.Filter.RED | exports.Filter.BLUE
exports.Filter = {}
exports.Filter.ANY = collisionGroupBits[4];

exports.WALL = collisionGroupBits[5]

// A group that collides with everything
exports.ALL = -1



exports.velocityToDiodeMask = function (velocity) {
    let mask = 0
    if(!velocity){
        return mask
    }

  if (velocity[0] < 0) {
    // traveling left
    mask = mask | exports.Diode.RIGHT
  } else if (velocity[0] > 0) {
    // traveling right
    mask = mask | exports.Diode.LEFT
  }
  if (velocity[1] < 0) {
    // traveling down
    mask = mask | exports.Diode.UP
  } else if (velocity[1] > 0) {
    // traveling up
    mask = mask | exports.Diode.DOWN
  }
  return mask
};
