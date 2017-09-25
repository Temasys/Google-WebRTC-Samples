/*
 *  Copyright (c) 2015 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */

'use strict';

var videoElement = document.querySelector('video');
var videoSelect = document.querySelector('select#videoSource');
var selectors = [videoSelect];

function gotDevices(deviceInfos) {
  // Handles being called several times to update labels. Preserve values.
  var values = selectors.map(function(select) {
    return select.value;
  });
  selectors.forEach(function(select) {
    while (select.firstChild) {
      select.removeChild(select.firstChild);
    }
  });

  for (var i = 0; i !== deviceInfos.length; ++i) {
    var deviceInfo = deviceInfos[i];
    var option = document.createElement('option');
    option.value = deviceInfo.id || deviceInfo.deviceId;
    if ( deviceInfo.kind === 'screen'
      || deviceInfo.kind === 'window') {
      option.text = deviceInfo.label;
      videoSelect.appendChild(option);
    } else {
      console.log('Some other kind of source/device: ', deviceInfo);
    }
  }
  selectors.forEach(function(select, selectorIndex) {
    if (Array.prototype.slice.call(select.childNodes).some(function(n) {
      return n.value === values[selectorIndex];
    })) {
      select.value = values[selectorIndex];
    }
  });
}

function getDevices() {
  return AdapterJS.WebRTCPlugin.plugin.getScreensharingSources(gotDevices);
}
AdapterJS.webRTCReady(getDevices);

function errorCallback(error) {
  console.log('navigator.getUserMedia error: ', error);
}

function gotStream(stream) {
  window.stream = stream; // make stream available to console
  videoElement = attachMediaStream(videoElement, stream);
  // Refresh button list in case labels have become available
  return getDevices();
}

function start() {
  if (window.stream) {
    window.stream.getTracks().forEach(function(track) {
      track.stop();
    });
  }
  var videoSource = videoSelect.value;
  var constraints = {
    audio: false,
    video: {
      mediaSource: AdapterJS.WebRTCPlugin.plugin.screensharingKey,
      optional: [
        {screenId: videoSelect.value}
      ]
    }
  };

  if (typeof Promise === 'undefined') {
    navigator.getUserMedia(constraints, gotStream, function(){});
  } else {
    navigator.mediaDevices.getUserMedia(constraints)
    .then(gotStream);
  }
}

videoSelect.onchange = start;
