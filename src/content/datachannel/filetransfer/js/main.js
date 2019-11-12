/* eslint no-unused-expressions: 0 */
/*
 *  Copyright (c) 2015 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
'use strict';

let localConnection;
let remoteConnection;
let sendChannel;
let receiveChannel;
let fileReader;
const bitrateDiv = document.querySelector('div#bitrate');
const fileInput = document.querySelector('input#fileInput');
const abortButton = document.querySelector('button#abortButton');
const downloadAnchor = document.querySelector('a#download');
const sendProgress = document.querySelector('progress#sendProgress');
const receiveProgress = document.querySelector('progress#receiveProgress');
const statusMessage = document.querySelector('span#status');
const sendFileButton = document.querySelector('button#sendFile');

let receiveBuffer = [];
let receivedSize = 0;

let bytesPrev = 0;
let timestampPrev = 0;
let timestampStart;
let statsInterval = null;
let bitrateMax = 0;
let fileType = '';
let sendingData = false;

sendFileButton.addEventListener('click', () => createConnection());
fileInput.addEventListener('change', handleFileInputChange, false);
abortButton.addEventListener('click', () => {
  if (fileReader && fileReader.readyState === 1) {
    console.log('Abort read!');
    fileReader.abort();
  }
});

async function handleFileInputChange() {
  let file = fileInput.files[0];
  if (!file) {
    console.log('No file chosen');
  } else {
    sendFileButton.disabled = false;
  }
}

async function createConnection() {
  abortButton.disabled = false;
  sendFileButton.disabled = true;
  localConnection = new RTCPeerConnection();
  console.log('Created local peer connection object localConnection');

  sendChannel = localConnection.createDataChannel('sendDataChannel');
  sendChannel.binaryType = 'arraybuffer';
  console.log('Created send data channel');


  AdapterJS.addEvent(sendChannel, 'open', onSendChannelStateChange);
  AdapterJS.addEvent(sendChannel, 'close', onSendChannelStateChange);
  AdapterJS.addEvent(sendChannel, 'error', error => console.error('Error in sendChannel:', error));

  AdapterJS.addEvent(localConnection, 'icecandidate', async event => {
    console.log('Local ICE candidate: ', event.candidate);
    await remoteConnection.addIceCandidate(event.candidate);
  });

  remoteConnection = new RTCPeerConnection();
  console.log('Created remote peer connection object remoteConnection');

  AdapterJS.addEvent(remoteConnection, 'icecandidate', async event => {
    console.log('Remote ICE candidate: ', event.candidate);
    await localConnection.addIceCandidate(event.candidate);
  });
  AdapterJS.addEvent(remoteConnection, 'datachannel', receiveChannelCallback);

  try {
    const offer = await localConnection.createOffer();
    await gotLocalDescription(offer);
  } catch (e) {
    console.log('Failed to create session description: ', e);
  }

  fileInput.disabled = true;
}

function sendData() {
  const file = fileInput.files[0];
  console.log(`File is ${[file.name, file.size, file.type, file.lastModified].join(' ')}`);

  // Handle 0 size files.
  statusMessage.textContent = '';
  downloadAnchor.textContent = '';
  if (file.size === 0) {
    bitrateDiv.innerHTML = '';
    statusMessage.textContent = 'File is empty, please select a non-empty file';
    closeDataChannels();
    sendingData = false;
    return;
  }
  fileType = file.type.length > 0 ? file.type : 'text/plain';
  sendProgress.max = file.size;
  receiveProgress.max = file.size;
  const chunkSize = 16384;
  fileReader = new FileReader();
  let offset = 0;
  fileReader.addEventListener('error', error => console.error('Error reading file:', error));
  fileReader.addEventListener('abort', event => console.log('File reading aborted:', event));
  fileReader.addEventListener('load', e => {
    console.log('FileRead.onload ', e.target.result.byteLength);
    const packet = new Int8Array(e.target.result, 0, e.target.result.byteLength);
    sendChannel.send(packet);
    offset += e.target.result.byteLength;
    sendProgress.value = offset;
    if (offset < file.size) {
      readSlice(offset);
    } else
      sendingData = false;
  });
  const readSlice = o => {
    console.log('readSlice ', o);
    const slice = file.slice(offset, o + chunkSize);
    fileReader.readAsArrayBuffer(slice);
  };
  readSlice(0);
}

function closeDataChannels() {
  console.log('Closing data channels');
  sendChannel.close();
  console.log(`Closed data channel with label: ${sendChannel.label}`);
  if (receiveChannel) {
    receiveChannel.close();
    console.log(`Closed data channel with label: ${receiveChannel.label}`);
  }
  localConnection.close();
  remoteConnection.close();
  localConnection = null;
  remoteConnection = null;
  console.log('Closed peer connections');

  // re-enable the file select
  fileInput.disabled = false;
  abortButton.disabled = true;
  sendFileButton.disabled = false;
}

async function gotLocalDescription(desc) {
  await localConnection.setLocalDescription(desc);
  console.log(`Offer from localConnection\n ${desc.sdp}`);
  await remoteConnection.setRemoteDescription(desc);
  try {
    const answer = await remoteConnection.createAnswer();
    await gotRemoteDescription(answer);
  } catch (e) {
    console.log('Failed to create session description: ', e);
  }
}

async function gotRemoteDescription(desc) {
  await remoteConnection.setLocalDescription(desc);
  console.log(`Answer from remoteConnection\n ${desc.sdp}`);
  await localConnection.setRemoteDescription(desc);
}

async function receiveChannelCallback(event) {
  console.log('Receive Channel Callback');
  receiveChannel = event.channel;
  receiveChannel.binaryType = 'arraybuffer';
  receiveChannel.onmessage = onReceiveMessageCallback;
  receiveChannel.onopen = onReceiveChannelStateChange;
  receiveChannel.onclose = onReceiveChannelStateChange;

  receivedSize = 0;
  bitrateMax = 0;
  downloadAnchor.textContent = '';
  downloadAnchor.removeAttribute('download');
  if (downloadAnchor.href) {
    URL.revokeObjectURL(downloadAnchor.href);
    downloadAnchor.removeAttribute('href');
  }
  await checkStateAndSendData();
}

function onReceiveMessageCallback(event) {
  const packet = new Int8Array(event.data);
  console.log(`Received packet byteLength: ${packet.byteLength}`);
  receiveBuffer.push(packet);
  receivedSize += packet.byteLength;

  receiveProgress.value = receivedSize;

  // we are assuming that our signaling protocol told
  // about the expected file size (and name, hash, etc).
  const file = fileInput.files[0];
  if (receivedSize === file.size) {
    const received = new Blob(receiveBuffer, {type: fileType});
    receiveBuffer = [];

    downloadAnchor.download = file.name;
    downloadAnchor.textContent =
      `Click to download '${file.name}' (${file.size} bytes)`;
    downloadAnchor.style.display = 'block';
    // IE doesn't allow using a blob object directly as link href
    // https://blog.jayway.com/2017/07/13/open-pdf-downloaded-api-javascript/
    if (window.navigator && window.navigator.msSaveOrOpenBlob) { // IE
      downloadAnchor.onclick = function() {
        window.navigator.msSaveOrOpenBlob(received);
      };
    } else
      downloadAnchor.href = URL.createObjectURL(received);

    const bitrate = Math.round(receivedSize * 8 /
      ((new Date()).getTime() - timestampStart));
    bitrateDiv.innerHTML
      = `<strong>Average Bitrate:</strong> ${bitrate} kbits/sec (max: ${bitrateMax} kbits/sec)`;

    if (statsInterval) {
      clearInterval(statsInterval);
      statsInterval = null;
    }

    closeDataChannels();
  }
}

async function checkStateAndSendData() {
  if(sendingData)
    return;
  if (!sendChannel || !receiveChannel)
    return;
  const sendChannelReadyState = sendChannel.readyState;
  const receiveChannelReadyState = receiveChannel.readyState;
  console.log(`checkStateAndSendData ; Send channel state : ${sendChannelReadyState},
    Receive channel state : ${receiveChannelReadyState}`);
  if (sendChannelReadyState !== 'open' || receiveChannelReadyState !== 'open')
    return;

  sendingData = true;
  timestampStart = (new Date()).getTime();
  timestampPrev = timestampStart;
  statsInterval = setInterval(displayStats, 500);
  await displayStats();

  sendData();
}

async function onSendChannelStateChange() {
  const readyState = sendChannel.readyState;
  console.log(`Send channel state is: ${readyState}`);
  await checkStateAndSendData();
}

async function onReceiveChannelStateChange() {
  const readyState = receiveChannel.readyState;
  console.log(`Receive channel state is: ${readyState}`);
  await checkStateAndSendData();
}

// display bitrate statistics.
async function displayStats() {
  if (remoteConnection && remoteConnection.iceConnectionState === 'connected') {
    const stats = await remoteConnection.getStats();
    let activeCandidatePair;
    for (let i = 0; i < stats.length; i++) {
      let report = stats[i];
      if (report.type === 'transport') {
        activeCandidatePair = stats.get(report.selectedCandidatePairId);
      }
    }
    if (activeCandidatePair) {
      if (timestampPrev === activeCandidatePair.timestamp) {
        return;
      }
      // calculate current bitrate
      const bytesNow = activeCandidatePair.bytesReceived;
      const bitrate = Math.round((bytesNow - bytesPrev) * 8 /
        (activeCandidatePair.timestamp - timestampPrev));
      bitrateDiv.innerHTML = `<strong>Current Bitrate:</strong> ${bitrate} kbits/sec`;
      timestampPrev = activeCandidatePair.timestamp;
      bytesPrev = bytesNow;
      if (bitrate > bitrateMax) {
        bitrateMax = bitrate;
      }
    }
  }
}
