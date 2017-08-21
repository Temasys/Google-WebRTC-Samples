var chunkLength = 1000;
var arrayToStoreChunks = [];
var sendCounter = 0;
var typeList = [Int8Array,
                Uint8Array,
                Int16Array,
                Uint16Array,
                Int32Array,
                Uint32Array,
                // Float32Array, 
                // Float64Array
                ];
var bufSize = 12;
var sendBuf = null;
var receiveBuf = null;

var localConnection, remotePeerConnection, sendChannel, receiveChannel, pcConstraint, dataConstraint;
var stream;
var sctpSelect = document.querySelector('input#useSctp');
var rtpSelect = document.querySelector('input#useRtp');
var startButton = document.querySelector('button#startButton');
var sendButton = document.querySelector('button#sendButton');
var closeButton = document.querySelector('button#closeButton');
var resultsTable = document.querySelector('table#resultsTable');

startButton.onclick = createConnection;
sendButton.onclick = startSending;
closeButton.onclick = closeDataChannels;
rtpSelect.onclick = enableStartButton;
sctpSelect.onclick = enableStartButton;

function enableStartButton() {
  startButton.disabled = false;
}

function disableSendButton() {
  sendButton.disabled = true;
}

rtpSelect.onclick = sctpSelect.onclick = function() {
  // dataChannelReceive.value = '';
  // dataChannelSend.value = '';
  disableSendButton();
  enableStartButton();
};

function createConnection() {
  // dataChannelSend.placeholder = '';
  var servers = null;
  pcConstraint = null;
  dataConstraint = null;
  if (sctpSelect.checked &&
     (webrtcDetectedBrowser === 'chrome' && webrtcDetectedVersion >= 31) ||
      webrtcDetectedBrowser === 'firefox' || webrtcDetectedBrowser === 'safari'
      || webrtcDetectedBrowser ==='IE'){
    // SCTP is supported from Chrome M31 and is supported in FF.
    // No need to pass DTLS constraint as it is on by default in Chrome M31.
    // For SCTP, reliable and ordered is true by default.
    console.log('Using SCTP based Data Channels');
  } else {
    pcConstraint = {optional: [{RtpDataChannels: true}]};
    if (!rtpSelect.checked) {
      // Use rtp data channels for chrome versions older than M31.
      console.log('Using RTP based Data Channels,' +
            'as you are on an older version than M31.');
      alert('Reverting to RTP based data channels,' +
            'as you are on an older version than M31.');
      rtpSelect.checked = true;
    }
  }
  localConnection = new RTCPeerConnection(servers, pcConstraint);
  if (webrtcDetectedType === 'AppleWebKit') localConnection.addStream(stream);
  console.log('Created local peer connection object localConnection');

  try {
    // Data Channel api supported from Chrome M25.
    // You might need to start chrome with  --enable-data-channels flag.
    sendChannel = localConnection.createDataChannel('sendDataChannel', dataConstraint);
    console.log('Created send data channel');
  } catch (e) {
    alert('Failed to create data channel. ' +
          'You need Chrome M25 or later with --enable-data-channels flag');
    console.log('Create Data channel failed with exception: ' + e.message);
  }
  localConnection.onicecandidate = iceCallback1;
  sendChannel.onopen = onSendChannelStateChange;
  sendChannel.onclose = onSendChannelStateChange;

  remotePeerConnection = new RTCPeerConnection(servers, pcConstraint);
  console.log('Created remote peer connection object remotePeerConnection');

  remotePeerConnection.onicecandidate = iceCallback2;
  remotePeerConnection.ondatachannel = receiveChannelCallback;

  localConnection.createOffer(gotDescription1, onCreateSessionDescriptionError);
  startButton.disabled = true;
  closeButton.disabled = false;
}

function onCreateSessionDescriptionError(error) {
  console.log('Failed to create session description: ' + error.toString());
}

function startSending() {
  // init values
  sendCounter = 0;

  // reset table
  while (resultsTable.children.length != 1)
    resultsTable.deleteRow(resultsTable.children.length - 1);

  // start testing process
  sendData();
}

function sendData() {
  // create a new buffer
  sendBuf = new typeList[sendCounter](bufSize);
  for (var i = 0; i < bufSize; i++) 
    sendBuf[i] = (Math.random() * 100);

  // log the value
  console.log('send: ');
  console.log(sendBuf);

  // send the buffer
  sendChannel.send(sendBuf);
}

function closeDataChannels() {
  console.log('Closing data Channels');
  sendChannel.close();
  console.log('Closed data channel with label: ' + sendChannel.label);
  receiveChannel.close();
  console.log('Closed data channel with label: ' + receiveChannel.label);
  localConnection.close();
  remotePeerConnection.close();
  localConnection = null;
  remotePeerConnection = null;
  console.log('Closed peer connections');
  startButton.disabled = false;
  sendButton.disabled = true;
  closeButton.disabled = true;
}

function gotDescription1(desc) {
  localConnection.setLocalDescription(desc);
  console.log('Offer from localConnection \n' + desc.sdp);
  remotePeerConnection.setRemoteDescription(desc);
  remotePeerConnection.createAnswer(gotDescription2, onCreateSessionDescriptionError);
}

function gotDescription2(desc) {
  remotePeerConnection.setLocalDescription(desc);
  console.log('Answer from remotePeerConnection \n' + desc.sdp);
  localConnection.setRemoteDescription(desc);
}

function iceCallback1(event) {
  console.log('local ice callback');
  if (event.candidate) {
    remotePeerConnection.addIceCandidate(event.candidate,
                        onAddIceCandidateSuccess, onAddIceCandidateError);
    console.log('Local ICE candidate: \n' + event.candidate.candidate);
  }
}

function iceCallback2(event) {
  console.log('remote ice callback');
  if (event.candidate) {
    localConnection.addIceCandidate(event.candidate,
                        onAddIceCandidateSuccess, onAddIceCandidateError);
    console.log('Remote ICE candidate: \n ' + event.candidate.candidate);
  }
}

function onAddIceCandidateSuccess() {
  console.log('AddIceCandidate success.');
}

function onAddIceCandidateError(error) {
  console.log('Failed to add Ice Candidate: ' + error.toString());
}

function receiveChannelCallback(event) {
  console.log('Receive Channel Callback');
  receiveChannel = event.channel;
  receiveChannel.onmessage = onReceiveMessageCallback;
  receiveChannel.onopen = onReceiveChannelStateChange;
  receiveChannel.onclose = onReceiveChannelStateChange;
}

function onReceiveMessageCallback(event) {
  // parse received data
  receiveBuf = new typeList[sendCounter](event.data);
  console.log('received: ');
  console.log(receiveBuf);

  // populate result table
  var row = document.createElement("tr");
  row.className = "resultRow";

  typeCell = document.createElement("td");
  sentCell = document.createElement("td");
  receivedCell = document.createElement("td");
  validCell = document.createElement("td");
  
  typeCell.className = "typeCell";
  sentCell.className = "sentValue";
  receivedCell.className = "receivedValue";
  validCell.className = "resultValidity";

  text = document.createTextNode(typeList[sendCounter].name);
  typeCell.appendChild(text);

  text = document.createTextNode(makeStringWithBuffer(sendBuf));
  sentCell.appendChild(text);

  text = document.createTextNode(makeStringWithBuffer(receiveBuf));
  receivedCell.appendChild(text);

  var valid = compareBuffers(sendBuf, receiveBuf);
  text = document.createTextNode(valid);
  validCell.appendChild(text);  
  validCell.style.background = valid ? 'green' : 'red'

  row.appendChild(typeCell);
  row.appendChild(sentCell);
  row.appendChild(receivedCell);
  row.appendChild(validCell);

  resultsTable.appendChild(row);

  // start next sending
  sendCounter++;
  if (sendCounter < typeList.length)
    sendData();
}

// strigigies a bufferview
function makeStringWithBuffer(buffer) {
  var str = '[';
  for (var i = 0; i < buffer.length; i++) {
    str += buffer[i];
    str += ', ';
  }
  str = str.substring(0, str.length - 2); // remove last comma
  str += ']';

  return str;
}

// compares 2 bufferviews 
function compareBuffers(b1, b2) {
  if (b1.length != b2.length)
    return false;

  for (var i = 0; i < b1.length; i++)
    if (b1[i] != b2[i])
      return false;

  return true;
}

function onSendChannelStateChange() {
  var readyState = sendChannel.readyState;
  console.log('Send channel state is: ' + readyState);
  if (readyState == 'open') {
    sendButton.disabled = false;
    closeButton.disabled = false;
  } else {
    sendButton.disabled = true;
    closeButton.disabled = true;
  }
}

function onReceiveChannelStateChange() {
  var readyState = receiveChannel.readyState;
  console.log('Receive channel state is: ' + readyState);
}

if (webrtcDetectedType === 'AppleWebKit') {
  var onSuccess = function(s) {
    stream = s;
    console.log('gum success');
  };
  var onFailure = function(error) {
    console.log('gum failure');
  };
  var constraints = window.constraints = {
    audio: false,
    video: true
  };
  navigator.mediaDevices.getUserMedia(constraints)
    .then(onSuccess).catch(onFailure);
}

