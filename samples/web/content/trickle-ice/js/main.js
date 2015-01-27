/*
 *  Copyright (c) 2014 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
var addButton = document.getElementById('add');
var candidateTBody = document.getElementById('candidatesBody');
var gatherButton = document.getElementById('gather');
var passwordInput = document.getElementById('password');
var removeButton = document.getElementById('remove');
var changeButton = document.getElementById('changeStruct');
var servers = document.getElementById('servers');
var urlInput = document.getElementById('url');
var usernameInput = document.getElementById('username');
var ipv6Check = document.getElementById('ipv6');
var unbundleCheck = document.getElementById('unbundle');
var output = document.getElementById('output');

addButton.onclick = addServer;
gatherButton.onclick = start;
removeButton.onclick = removeServer;
changeButton.onclick = changeStruct;

var begin, pc;
var changed = false;

function changeStruct(){
  if(!changed){
    for(var i = servers.options.length - 1; i>=0; --i) {
      var sers = JSON.parse(servers[i].value);
      if(typeof sers.url === "string"){
        servers[i].value = servers[i].value.replace("\":\"", "\":[\"");
        servers[i].value = servers[i].value.replace("\",", "\"],");
        servers[i].text = '[' + servers[i].text + ']';
      }
    }
    changed = !changed;
  }else{
    for(var i = servers.options.length - 1; i>=0; --i) {
      var sers = JSON.parse(servers[i].value);
      if(sers.url.length === 1 ){
        servers[i].value = servers[i].value.replace("\":[\"", "\":\"");
        servers[i].value = servers[i].value.replace("\"],", "\",");   
        servers[i].text = servers[i].text.substr(1, servers[i].text.length - 2);
      }
    }
    changed = !changed;
  }
}
function addServer() {
  var scheme = urlInput.value.split(':')[0];
  if (scheme !== 'stun' && scheme !== 'turn' && scheme !== 'turns') {
    alert('URI scheme ' + scheme + ' is not valid');
    return;
  }

  // Store the ICE server as a stringified JSON object in option.value.
  var option = document.createElement('option');
  var iceServer = createIceServer(urlInput.value, usernameInput.value, passwordInput.value);
  option.value = JSON.stringify(iceServer);
  if(changed){
    option.text = '[' + urlInput.value + '] ';
  }else{
    option.text = urlInput.value + ' ';
  }
  var username = usernameInput.value;
  var password = passwordInput.value;
  if (username || password) {
    option.text += (' [' + username + ':' + password + ']');
  }
  servers.add(option);
  urlInput.value = usernameInput.value = passwordInput.value = '';
}

function removeServer() {
  for (var i = servers.options.length - 1; i >= 0; --i) {
    if (servers.options[i].selected) {
      servers.remove(i);
    }
  }
}

function start() {
  // Clean out the table.
  while (candidateTBody.firstChild) {
    candidateTBody.removeChild(candidateTBody.firstChild);
  }

  
  // Read the values from the input boxes.
  output.value = '';
  var iceServers = [];
  for (var i = 0; i < servers.length; ++i) {
     iceServers.push(JSON.parse(servers[i].value));
  }
  var transports = document.getElementsByName('transports');
  var iceTransports;
  for (i = 0; i < transports.length; ++i) {
    if (transports[i].checked) {
      iceTransports = transports[i].value;
      break;
    }
  }

  // Create a PeerConnection with no streams, but force a m=audio line.
  // This will gather candidates for either 1 or 2 ICE components, depending
  // on whether the unbundle RTCP checkbox is checked.
  var config = {"iceServers":iceServers};
  var pcConstraints = {"mandatory": {"IceTransports": iceTransports}};
  var offerConstraints = {"mandatory": {"OfferToReceiveAudio": true}};
  // Whether we gather IPv6 candidates.
  pcConstraints.optional = [{"googIPv6": ipv6Check.checked}];
  // Whether we only gather a single set of candidates for RTP and RTCP.
  offerConstraints.optional = [{"googUseRtpMUX": !unbundleCheck.checked}];

  console.log("Creating new PeerConnection with config=" + JSON.stringify(config) +
        ", constraints=" + JSON.stringify(pcConstraints));
  pc = new RTCPeerConnection(config, pcConstraints);
  pc.onicecandidate = iceCallback;
  pc.createOffer(gotDescription, noDescription, offerConstraints);
}

function gotDescription(desc) {
  // begin = window.performance.now();
  pc.setLocalDescription(desc);
}

function noDescription(error) {
  console.log("Error creating offer");
}

// Parse a candidate:foo string into an object, for easier use by other methods.
function parseCandidate(text) {
  var candidateStr = "candidate:";
  var pos = text.indexOf(candidateStr) + candidateStr.length;
  var fields = text.substr(pos).split(" ");
  return {
    "component": fields[1],
    "type": fields[7],
    "foundation": fields[0],
    "protocol": fields[2],
    "address": fields[4],
    "port": fields[5],
    "priority": fields[3]
  };
}

// Parse the uint32 PRIORITY field into its constituent parts from RFC 5245,
// type preference, local preference, and (256 - component ID).
// ex: 126 | 32252 | 255 (126 is host preference, 255 is component ID 1)
function formatPriority(priority) {
  var s = "";
  s += (priority >> 24);
  s += " | ";
  s += (priority >> 8) & 0xFFFF;
  s += " | ";
  s += priority & 0xFF;
  return s;  
}

function appendCell(row, val, span) {
  var cell = document.createElement("td");
  cell.textContent = val;
  if (span) {
    cell.setAttribute("colspan", span);
  }
  row.appendChild(cell);
}

function iceCallback(event) {
  // var elapsed = ((window.performance.now() - begin) / 1000).toFixed(3);
  var row = document.createElement("tr");
  if (event.candidate) {
    output.value += (event.candidate.candidate);
    output.value += "\n";

    appendCell(row, "Not captured");
    var c = parseCandidate(event.candidate.candidate);
    appendCell(row, c.component);
    appendCell(row, c.type);
    appendCell(row, c.foundation);
    appendCell(row, c.protocol);
    appendCell(row, c.address);
    appendCell(row, c.port);
    appendCell(row, formatPriority(c.priority));
  } else {
    // appendCell(row, "Done", 7);
    pc.close();
    pc = null;
  }
  candidateTBody.appendChild(row);
}
