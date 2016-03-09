/*
 *  Copyright (c) 2015 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */

'use strict';

var snapshotButton = document.querySelector('button#snapshot');
var filterSelect = document.querySelector('select#filter');

// Put variables in global scope to make them available to the browser console.
var video = window.video = document.querySelector('video');
var canvas = window.canvas = document.querySelector('canvas');
canvas.width = 480;
canvas.height = 360;

snapshotButton.onclick = function() {
  canvas.className = filterSelect.value;
  var base64 = video.getFrame();
  var image = new Image();
  image.onload = function () {
      canvas.getContext("2d").
      drawImage(image, 0, 0, canvas.width, canvas.height);
  };
  image.setAttribute('src', "data:image/png;base64," + base64);
};

filterSelect.onchange = function() {
  video.className = filterSelect.value;
};

var constraints = {
  audio: false,
  video: true
};

function successCallback(stream) {
  window.stream = stream; // make stream available to browser console
  video = attachMediaStream(video, stream); 
}

function errorCallback(error) {
  console.log('navigator.getUserMedia error: ', error);
}

navigator.getUserMedia(constraints, successCallback, errorCallback);
