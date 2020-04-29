const msgpack = require("msgpack-lite");
// mod(-1, 100) -> 99
// mod(101, 100) -> 1
exports.mod = function (n, d) {
  return ((n % d) + d) % d;
}

// nearestMulitple(8, 9) => 9
// nearestMultiple(10, 9) => 9
// nearestMultiple(15, 9) => 18
// nearestMultiple(1, 9) => 0
//
// (Float, Int) => Int
exports.nearestMultiple = function (n, mult) {
  return mult * Math.round(n / mult)
}



exports.rad2deg = function (rad) {
  return rad * 180 / Math.PI
}


exports.deg2rad = function (deg) {
  return deg * Math.PI / 180
}


exports.clampDeg = function (deg) {
  return exports.mod(exports.nearestMultiple(deg, 9), 360)
}


exports.clampRad = function (rad) {
  return exports.deg2rad(exports.clampDeg(exports.rad2deg(rad)))
}


// cheaper mod
exports.normalizeRad = function (rad) {
  rad = rad % (Math.PI * 2)
  if (rad < 0){
    rad += (Math.PI * 2)
  }
  return rad
}


exports.randInt = function (min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min)
}


exports.randNth = function (items) {
  return items[Math.floor(Math.random() * items.length)]
}


// maps 'RED' -> 'BLUE' and 'BLUE' -> 'RED'
exports.flipTeam = function (team) {
  console.assert(team === 'RED' || team === 'BLUE')
  return team === 'RED' ? 'BLUE' : 'RED'
}


// CONVERT GAME PIXEL UNITS <-> P2 METER SCALE


exports.pxm = function (pixels) {
  return pixels * 0.05
}


exports.mxp = function (meters) {
  return meters * 20
}

exports.unpackBinaryMsgPack = (data) => {
    try{
        return msgpack.decode(new Uint8Array(data));
    }catch(error){
        console.log("Error with websocket communication.");
    }
};

const roundAndStripExtraZeros = function(numberToRound, numOfPlacesToRoundTo = 2){
  return (numberToRound >= 0 || -1) * +Math.abs(numberToRound).toFixed(numOfPlacesToRoundTo);
  // (numberToRound >= 0 || -1) keeps it negative or positive
  // Note the plus sign that drops any "extra" zeroes at the end.
  // It changes the result (which is a string) into a number again (think "0 + foo"),
  // which means that it uses only as many digits as necessary.
};
exports.roundAndStripExtraZeros = roundAndStripExtraZeros;

exports.roundAndStripVector = (oldVector, numOfPlacesToRoundTo = 2) => {
    return {x: roundAndStripExtraZeros(oldVector.x, numOfPlacesToRoundTo) , y: roundAndStripExtraZeros(oldVector.y, numOfPlacesToRoundTo)};
};

exports.gameStateTimeFormat = function(seconds){
    // Hours, minutes and seconds
    let hrs = Math.floor(seconds / 3600);
    let mins = Math.floor((seconds % 3600) / 60);
    let secs = seconds % 60;

    // Output like "1:01" or "4:03:59" or "123:03:59"
    let ret = "";

    if (hrs > 0) {
        ret += "" + hrs + ":" + (mins < 10 ? "0" : "");
    }

    ret += "" + mins + ":" + (secs < 10 ? "0" : "");
    ret += "" + secs;
    return ret;
};

exports.pickRandomPropFromObj = function(obj){
    const keys = Object.keys(obj);
    return obj[keys[ keys.length * Math.random() << 0]];
};

exports.distanceBetweenTwoPositions = function(posVec1,posVec2){
    const a = posVec1.x - posVec2.x;
    const b = posVec1.y - posVec2.y;
    return Math.sqrt( a*a + b*b );
};

exports.gameConstants = {
    playerType_roleDescriptions: {1: "a Human", 2: "the Peace Keeper", 3: "the Intruder"},
    playerType_human: 1,
    playerType_peaceKeeper: 2,
    playerType_intruder: 3
};