/*
 *  Copyright (c) 2015 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */

var localConnection;
var remoteConnection;
var sendChannel;
var receiveChannel;
var pcConstraint;
var bitrateDiv = document.querySelector('div#bitrate');
var fileInput = document.querySelector('input#fileInput');
var downloadAnchor = document.querySelector('a#download');
var sendProgress = document.querySelector('progress#sendProgress');
var receiveProgress = document.querySelector('progress#receiveProgress');
var statusMessage = document.querySelector('span#status');

var receiveBuffer = [];
var receivedSize = 0;

var bytesPrev = 0;
var timestampPrev = 0;
var timestampStart;
var statsInterval = null;
var bitrateMax = 0;
var fileType = '';

fileInput.addEventListener('change', createConnection, false);

function createConnection() {
  var servers = null;
  pcConstraint = null;

  // Add localConnection to global scope to make it visible
  // from the browser console.
  window.localConnection = localConnection = new RTCPeerConnection(servers,
      pcConstraint);
  trace('Created local peer connection object localConnection');

  sendChannel = localConnection.createDataChannel('sendDataChannel', {ordered: true});
  sendChannel.binaryType = 'arraybuffer';
  trace('Created send data channel');

  sendChannel.onopen = onSendChannelStateChange;
  sendChannel.onclose = onSendChannelStateChange;
  localConnection.onicecandidate = iceCallback1;

  localConnection.createOffer(gotDescription1, onCreateSessionDescriptionError);
  // Add remoteConnection to global scope to make it visible
  // from the browser console.
  window.remoteConnection = remoteConnection = new RTCPeerConnection(servers,
      pcConstraint);
  trace('Created remote peer connection object remoteConnection');

  remoteConnection.onicecandidate = iceCallback2;
  remoteConnection.ondatachannel = receiveChannelCallback;

  fileInput.disabled = true;
}

function onCreateSessionDescriptionError(error) {
  trace('Failed to create session description: ' + error.toString());
}

function sendData() {
  var file = fileInput.files[0];
  receiveBuffer = [];
  trace('file is ' + [file.name, file.size, file.type,
      file.lastModifiedDate].join(' '));

  // Handle 0 size files.
  statusMessage.textContent = '';
  downloadAnchor.textContent = '';
  if (file.size === 0) {
    bitrateDiv.innerHTML = '';
    statusMessage.textContent = 'File is empty, please select a non-empty file';
    closeDataChannels();
    return;
  }
  sendProgress.max = file.size;
  receiveProgress.max = file.size;
  fileType = file.type.length > 0 ? file.type : 'text/plain';
  var chunkSize = 16384;
  var bufferFullThreshold = 5 * chunkSize;
  var usePolling = true;
  if (typeof sendChannel.bufferedAmountLowThreshold === 'number') {
    trace('Using the bufferedamountlow event for flow control');
    usePolling = false;

    // Reduce the buffer fullness threshold, since we now have more efficient
    // buffer management.
    bufferFullThreshold = chunkSize / 2;

    // This is "overcontrol": our high and low thresholds are the same.
    sendChannel.bufferedAmountLowThreshold = bufferFullThreshold;
  }
  // Listen for one bufferedamountlow event.
  var listener = function() {
    sendChannel.removeEventListener('bufferedamountlow', listener);
    sliceFile(offset);
  };
  var sliceFile = function(offset) {
    var reader = new window.FileReader();
    reader.onload = (function() {
      return function(e) {
        var packet = new Int8Array(e.target.result, 0, e.target.result.byteLength);
        if (sendChannel.bufferedAmount > bufferFullThreshold) {
          if (usePolling) {
            setTimeout(sliceFile, 150, offset);
          } else {
            sendChannel.addEventListener('bufferedamountlow', listener);
          }
          return;
        }
        sendChannel.send(packet, Int8Array.toString().match(/function\s*([^\s(]+)/)[1]);
        if (file.size > offset + e.target.result.byteLength) {
          window.setTimeout(sliceFile, 0, offset + chunkSize);
        }
        sendProgress.value = offset + e.target.result.byteLength;
      };
    })(file);
    var slice = file.slice(offset, offset + chunkSize);
    reader.readAsArrayBuffer(slice);
  };
  sliceFile(0);
}

function closeDataChannels() {
  trace('Closing data channels');
  sendChannel.close();
  trace('Closed data channel with label: ' + sendChannel.label);
  if (receiveChannel) {
    receiveChannel.close();
    trace('Closed data channel with label: ' + receiveChannel.label);
  }
  localConnection.close();
  remoteConnection.close();
  localConnection = null;
  remoteConnection = null;
  trace('Closed peer connections');

  // re-enable the file select
  fileInput.disabled = false;
}

function gotDescription1(desc) {
  localConnection.setLocalDescription(desc);
  trace('Offer from localConnection \n' + desc.sdp);
  remoteConnection.setRemoteDescription(desc);
  remoteConnection.createAnswer(gotDescription2,
      onCreateSessionDescriptionError);
}

function gotDescription2(desc) {
  remoteConnection.setLocalDescription(desc);
  trace('Answer from remoteConnection \n' + desc.sdp);
  localConnection.setRemoteDescription(desc);
}

function iceCallback1(event) {
  trace('local ice callback');
  if (event.candidate) {
    remoteConnection.addIceCandidate(event.candidate,
        onAddIceCandidateSuccess, onAddIceCandidateError);
    trace('Local ICE candidate: \n' + event.candidate.candidate);
  }
}

function iceCallback2(event) {
  trace('remote ice callback');
  if (event.candidate) {
    localConnection.addIceCandidate(event.candidate,
        onAddIceCandidateSuccess, onAddIceCandidateError);
    trace('Remote ICE candidate: \n ' + event.candidate.candidate);
  }
}

function onAddIceCandidateSuccess() {
  trace('AddIceCandidate success.');
}

function onAddIceCandidateError(error) {
  trace('Failed to add Ice Candidate: ' + error.toString());
}

function receiveChannelCallback(event) {
  trace('Receive Channel Callback');
  receiveChannel = event.channel;
  receiveChannel.binaryType = 'arraybuffer';
  receiveChannel.onmessage = onReceiveMessageCallback;
  if (receiveChannel.readyState === 'open') {
    onReceiveChannelStateChange();
  } else {
    receiveChannel.onopen = onReceiveChannelStateChange;
  }
  receiveChannel.onclose = onReceiveChannelStateChange;

  receivedSize = 0;
  bitrateMax = 0;
  downloadAnchor.textContent = '';
  downloadAnchor.removeAttribute('download');
  if (downloadAnchor.href) {
    URL.revokeObjectURL(downloadAnchor.href);
    downloadAnchor.removeAttribute('href');
  }
  trySending();
}

function onReceiveMessageCallback(event) {
  // trace('Received Message ' + event.data.byteLength);
  var packet = new Int8Array(event.data);
  receiveBuffer.push(packet);
  receivedSize += packet.byteLength;

  receiveProgress.value = receivedSize;

  // we are assuming that our signaling protocol told
  // about the expected file size (and name, hash, etc).
  var file = fileInput.files[0];
  if (receivedSize >= file.size) {
    var received = new window.Blob(receiveBuffer, {type: fileType});

    downloadAnchor.href = URL.createObjectURL(received);
    downloadAnchor.download = file.name;
    downloadAnchor.textContent =
      'Click to download \'' + file.name + '\' (' + file.size + ' bytes)';
    downloadAnchor.style.display = 'block';

    if (statsInterval) {
      window.clearInterval(statsInterval);
      statsInterval = null;
    }

    closeDataChannels();

    var bitrate = Math.round(receivedSize * 8 /
        ((new Date()).getTime() - timestampStart));
    bitrateDiv.innerHTML = '<strong>Average Bitrate:</strong> ' +
        bitrate + ' kbits/sec (max: ' + bitrateMax + ' kbits/sec)';
  }
}

function onSendChannelStateChange() {
  var readyState = sendChannel.readyState;
  trace('Send channel state is: ' + readyState);
  trySending();
}

function onReceiveChannelStateChange() {
  var readyState = receiveChannel.readyState;
  trace('Receive channel state is: ' + readyState);
  if (readyState === 'open') {
    timestampStart = (new Date()).getTime();
    timestampPrev = timestampStart;
    statsInterval = window.setInterval(displayStats, 500);
  }
}

function trySending() {
  if (sendChannel && sendChannel.readyState === 'open' &&
    receiveChannel && receiveChannel.readyState === 'open') {
    sendData();
  }  
}

// display bitrate statistics.
function displayStats() {
  if (remoteConnection &&
    remoteConnection.iceConnectionState === 'connected') {
    // TODO: once https://code.google.com/p/webrtc/issues/detail?id=4321
    // lands those stats should be preferrred over the connection stats.
    remoteConnection.getStats(null, function(stats) {
      if (statsInterval === null) {
        // file was already completely sent
        return;
      }
      for (var key in stats) {
        var res = stats[key];
        if (res.type === 'googCandidatePair' &&
            res.googActiveConnection === 'true') {
          // calculate current bitrate
          var bytesNow = res.bytesReceived;
          var bitrate = Math.round((bytesNow - bytesPrev) * 8 /
              (res.timestamp - timestampPrev));
          // display(bitrate);
          bitrateDiv.innerHTML = '<strong>Current Bitrate:</strong> ' +
              bitrate + ' kbits/sec';
          timestampPrev = res.timestamp;
          bytesPrev = bytesNow;
          if (bitrate > bitrateMax) {
            bitrateMax = bitrate;
          }
        }
      }
    }, function(e) {console.log('GetStats failure ', e);});
  }
}
