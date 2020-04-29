const socketio = require('socket.io');
let io = null; 

function startSocketIO(expressServer){
    io = require('socket.io').listen(expressServer);
}

function getIO(){
    return io;
}

module.exports = {
    startSocketIO: startSocketIO,
    getIO: getIO
}
