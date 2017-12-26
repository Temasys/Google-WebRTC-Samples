/*
 *  Copyright (c) 2015 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */

'use strict';

var startButton = document.getElementById('startButton');
var callButton = document.getElementById('callButton');
var hangupButton = document.getElementById('hangupButton');
callButton.disabled = true;
hangupButton.disabled = true;
startButton.onclick = start;
callButton.onclick = call;
hangupButton.onclick = hangup;

var startTime;
var renderersDiv = document.getElementById('renderers');
var localVideo = document.getElementById('localVideo');
var remoteVideo = document.getElementById('remoteVideo');
var userId_ = uuid.v4();

var localStream;
var pc;
var offerOptions = {
  offerToReceiveAudio: 1,
  offerToReceiveVideo: 1
};

function getName(pc) {
  return (pc === pc) ? 'pc' : 'pc2';
}

function getOtherPc(pc) {
  return (pc === pc) ? pc2 : pc;
}

function gotStream(stream) {
  trace('Received local stream');
  localVideo = attachMediaStream(localVideo, stream);
  localStream = stream;
  callButton.disabled = false;
  call();
}

function gumFailed(e) {
  alert('getUserMedia() error: ' + e.name);
}

function start() {
  trace('Requesting local stream');
  startButton.disabled = true;
  var constraints = window.constraints = {
    audio: false,
    video: true
  };
  if (typeof Promise === 'undefined') {
    navigator.getUserMedia(constraints, gotStream, gumFailed);
  } else {
    navigator.mediaDevices.getUserMedia(constraints)
    .then(gotStream)
    .catch(gumFailed);
  }
}

function call() {
  callButton.disabled = true;
  hangupButton.disabled = false;
  trace('Starting call');

  var servers = null;
  pc = new RTCPeerConnection(servers);
  trace('Created local peer connection object pc');
  pc.onicecandidate = function(e) {
    onIceCandidate(pc, e);
  };
  pc.oniceconnectionstatechange = function(e) {
    onIceStateChange(pc, e);
  };
  pc.addStream(localStream);
  pc.onaddstream = gotRemoteStream;
  pc.onremovestream = onRemoveStream;

  trace('Added local stream to pc');

  trace('pc createOffer start');
  pc.createOffer(onCreateOfferSuccess, onCreateSessionDescriptionError,
      offerOptions);
}

function onCreateSessionDescriptionError(error) {
  trace('Failed to create session description: ' + error.toString());
}

function onCreateOfferSuccess(desc) {
  trace('Offer from pc\n' + desc.sdp);
  trace('pc setLocalDescription start');
  pc.setLocalDescription(desc, function() {
    onSetLocalSuccess(pc);
  }, onSetSessionDescriptionError);

  // Send Offer to MCU
  // desc.userId = userId_;
  socket.emit('joinRoom', desc);
}

function onCreateAnswerSuccess(desc) {
  trace('Answer from pc2:\n' + desc.sdp);
  trace('pc2 setLocalDescription start');
  pc.setLocalDescription(desc, function() {
    onSetLocalSuccess(pc);
  }, onSetSessionDescriptionError);

  // Send Offer to MCU
  // desc.userId = userId_;
  socket.emit('answerRenego', desc);
};

function onSetLocalSuccess(pc) {
  trace('setLocalDescription complete');
}

function onSetRemoteSuccess(pc) {
  trace(' setRemoteDescription complete');
}

function onSetSessionDescriptionError(error) {
  trace('Failed to set session description: ' + error.toString());
}

function gotRemoteStream(e) {
  trace('gotRemoteStream');
  var stream = e.stream;
  var video = document.createElement('video');
  video.id = stream.id;
  renderersDiv.append(video);
  video = attachMediaStream(video, stream);
}

function onRemoveStream(e) {
  console.log('onRemoveStream');
  var video = document.getElementById(e.stream.id);
  video.parentNode.removeChild(video);
}

function onIceCandidate(pc, event) {
  // send ice candidate to MCU
  socket.emit('iceCandidate', event.candidate);
}

///////////////////////////////////////////////////////
// Socket io receive callbacks
///////////////////////////////////////////////////////
function onWelcome(msg) {
  trace('onWelcome');
  trace('Answer from MCU:\n' + msg);
  var sdp = new RTCSessionDescription(msg);
  pc.setRemoteDescription(sdp, function() {
    onSetRemoteSuccess(pc);
  }, onSetSessionDescriptionError);
}

function onRemoteIceCandidate(msg) {
  trace('onRemoteIceCandidate', msg);
  var candidate = new RTCIceCandidate(msg);
  pc.addIceCandidate(msg);
}

function onAskRenego(msg) {
  trace('onAskRenego');
  trace('Offer from MCU:\n' + msg);
  var sdp = new RTCSessionDescription(msg);
  pc.setRemoteDescription(sdp, function() {
    onSetRemoteSuccess(pc);
  }, onSetSessionDescriptionError);
  // TODO : race issue due to setRemote being async ??
  pc.createAnswer(onCreateAnswerSuccess, onCreateSessionDescriptionError)
}

///////////////////////////////////////////////////////

function onAddIceCandidateSuccess(pc) {
  trace(getName(pc) + ' addIceCandidate success');
}

function onAddIceCandidateError(pc, error) {
  trace(getName(pc) + ' failed to add ICE Candidate: ' + error.toString());
}

function onIceStateChange(pc, event) {
  if (pc) {
    trace(getName(pc) + ' ICE state: ' + pc.iceConnectionState);
    console.log('ICE state change event: ', event);
  }
}

function hangup() {
  trace('Ending call');
  pc.close();
  pc = null;
  hangupButton.disabled = true;
  callButton.disabled = false;
}

//////////////////////////////////////////////////////////
/// SocketIO
//////////////////////////////////////////////////////////
var socket = io("http://localhost:3000");
socket.on('connect', function(){
  // socket.send('yolo');
  // socket.emit('news', 'qqq');
});
socket.on('event', function(data){});
socket.on('disconnect', function(){});
socket.on('welcome', onWelcome);
socket.on('iceCandidate', onRemoteIceCandidate);
socket.on('askRenego', onAskRenego);

start();