/*
 *  Copyright (c) 2018 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
'use strict';

// Put variables in global scope to make them available to the browser console.
var video;
var stream;

var startBtn = document.querySelector('#startBtn');

function getDisplayMedia() {
  console.log('Start capturing.');
  if (navigator.getDisplayMedia) {
    return navigator.getDisplayMedia({video: true});
  } else if (navigator.mediaDevices.getDisplayMedia) {
    return navigator.mediaDevices.getDisplayMedia({video: true});
  } else {
    return navigator.mediaDevices.getUserMedia({video: {mediaSource: 'screen'}});
  }
}


function handleSuccess() {
  video = document.querySelector('video');
  const videoTracks = stream.getVideoTracks();
  console.log(`Using video device: ${videoTracks[0].label}`);
  video = attachMediaStream(video, stream);
}

function handleError(error) {
  errorMsg(`getDisplayMedia error: ${error.name}`, error);
}

function errorMsg(msg, error) {
  const errorElement = document.querySelector('#errorMsg');
  errorElement.innerHTML += `<p>${msg}</p>`;
  if (typeof error !== 'undefined') {
    console.error(error);
  }
}

async function startScreenCapture(e) {
  try {
    stream = await getDisplayMedia();
    handleSuccess();
    e.target.disabled = true;
  } catch (err) {
    handleError(err);
    e.target.disabled = false;
  }
}

startBtn.addEventListener('click', e => startScreenCapture(e));
