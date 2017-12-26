/*
 *  Copyright (c) 2015 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
 /* eslint-env node */

'use strict';

var express = require('express');
var https = require('https');
var pem = require('pem');
var http_ = require('http')

pem.createCertificate({days: 1, selfSigned: true}, function(err, keys) {
  var options = {
    key: keys.serviceKey,
    cert: keys.certificate
  };

  var app = express();

  app.use(express.static('../'));

  // Create an HTTPS service.
  http_.createServer(app).listen(8000);

  console.log('serving on https://localhost:8080');
});

var app = express();
var http = http_.Server(app);
var io = require('socket.io')(http);
var redis = require("redis"),
    client = redis.createClient();

client.on("error", function (err) {
  console.log("Error " + err);
});

var sockets = {};
var redisPub = redis.createClient();
var redisSub = redis.createClient();

redisSub.on("message", function (channel, message) {
  // Redis just forwards messages to the peer
  console.log("sub channel " + channel + ": " + message);
  var msg = JSON.parse(message);
  var socketId = msg.userId;
  if (sockets[socketId])
    sockets[socketId].emit(msg.action, msg);
});


redisSub.subscribe("SIG");

app.get('/', function(req, res){
  // res.sendFile(__dirname + '/../src/content/peerconnection/mcu/index.html');
});

io.on('connection', function(socket){
  console.log('a user connected');
  sockets[socket.id] = socket;
  socket.on('joinRoom',     onJoinRoom);
  socket.on('iceCandidate', onIceCandidate);
  socket.on('answerRenego', onAnswerRenego);
  socket.on('disconnect',   onSocketDisconnecting);
});

http.listen(3000, function(){
  console.log('listening on *:3000');
});

function onJoinRoom(desc, arg2, arg3) {
  console.log('onJoinRoom', desc);
  var msg = {
    action: 'joinRoom',
    userId: this.id, // socketId. In real life, should be userId
    type: desc.type,
    sdp: desc.sdp
  };
  redisPub.publish('MCU', JSON.stringify(msg));
}

function onAnswerRenego(desc, arg2, arg3) {
  console.log('onAnswerRenego', desc);
  var msg = {
    action: 'answerRenego',
    userId: this.id, // socketId. In real life, should be userId
    type: desc.type,
    sdp: desc.sdp
  };
  redisPub.publish('MCU', JSON.stringify(msg));
}

function onIceCandidate(candidate) {
  console.log('onIceCandidate', candidate);
  if (candidate) {
    var msg = {
      action: 'iceCandidate',
      userId: this.id, // socketId. In real life, should be userId
      candidate: candidate.candidate,
      sdpMLineIndex: candidate.sdpMLineIndex,
      sdpMid: candidate.sdpMid,
    };
    redisPub.publish('MCU', JSON.stringify(msg));
  }
}

function onSocketDisconnecting() {
  console.log('onSocketDisconnecting');
  sockets[this.id] = null;
  var msg = {
    action: 'peerLeft',
    userId: this.id, // socketId. In real life, should be userId
  };

  redisPub.publish('MCU', JSON.stringify(msg));
}
