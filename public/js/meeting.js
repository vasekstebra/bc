'use strict';

$(document).ready(function() {

    var self = this;
    var stream;
    var video = false;
    var audio = false;
    var peers = [];
    var rtcPeerConnectionConfig = {'iceServers': [{ 'url': 'stun:stun.l.google.com:19302' }]};
    var peerConnections = {};
    var waitingPeers = [];
    var waitingOffers = [];

    $('#chat-message').on('keypress', function(e) {
        if (e.which === 13) {
            self.sendMessage();
        }
    });

    $('#send-message').click(function() {
        self.sendMessage();
    });

    self.socket = io.connect('https://mtg.sde.cz');
    self.socket.emit('init', MEETING_ID, USER_EMAIL, USER_ID);

    self.socket.on('chat message', function(msg) {
        var message = $('<p class="bg-primary message"></p>');

        var sender = $('<strong></strong>');
        sender.append(self.escapeHtml(msg.sender) + ' ' );
        message.append(sender);

        message.append(self.escapeHtml(msg.text));
        $('#chat-messages').prepend(message);
    });

    self.sendMessage = function() {
        var messageContent = $('#chat-message').val();
        messageContent = self.escapeHtml(messageContent);
        if ( ! messageContent) {
            return;
        }
        var message = $('<p class="bg-info message-right"></p>');
        message.append(messageContent);
        $('#chat-messages').prepend(message);
        self.socket.emit('chat message', {sender: USER_EMAIL, text: messageContent});
        $('#chat-message').val('').focus();
    };

    self.socket.on('peer.connected', function(user) {
        toastr.info(user.email + ' has joined the conference');
        if (stream) {
            self.makeOffer(user.id);
        } else {
            waitingPeers.push({id: user.id, handled: false});
        }
    });

    self.socket.on('peer.disconnected', function (user) {
        toastr.warning(user.email + ' has left the conference');
        peers = peers.filter(function (peer) {
            return peer.id !== user.id;
        });
        self.endPeerConnection(user.id);
        $("#" + user.id).remove();
    });

    self.socket.on('webrtc.message', function(message) {
        if (stream) {
            self.handleMessage(message);
        } else {
            waitingOffers.push({message: message, handled: false});
        }
    });

    self.createPeerConnection = function (id) {
        if (peerConnections[id]) {
            return peerConnections[id];
        }
        var peerConnection = new RTCPeerConnection(rtcPeerConnectionConfig);
        peerConnections[id] = peerConnection;
        peerConnection.addStream(stream);
        peerConnection.onicecandidate = function (candidate) {
            self.socket.emit('webrtc.message', {from: USER_ID, to: id, ice: candidate.candidate, type: 'ice'});
        };
        peerConnection.onaddstream = function(stream) {
            var s = URL.createObjectURL(stream.stream);
            peers.push({id: id, stream: s});

            var container = $('<div></div>');
            container.addClass('col-sm-4');
            container.attr('id', id);
            var videoContainer = $('<div></div>');
            videoContainer.addClass('remote-video-container');
            container.append(videoContainer);

            var video = $('<video></video>');
            video.attr('autoplay', 'autoplay');
            video.addClass('remote-video');
            video.attr('src', s);
            videoContainer.append(video);

            $('#remote-videos').append(container);
            video.click(function() {
                if (screenfull.enabled) {
                    screenfull.toggle(this);
                }
            });
        };
        return peerConnection;
    };

    self.endPeerConnection = function (id) {
        var pc = self.createPeerConnection(id);
        pc.close();
        delete peerConnections[id];
    };

    self.makeOffer = function(id) {
        var peerConnection = self.createPeerConnection(id);
        peerConnection.createOffer(function (sdp) {
            peerConnection.setLocalDescription(sdp);
            self.socket.emit('webrtc.message', {from: USER_ID, to: id, sdp: sdp, type: 'sdp-offer'});
        }, function (e) {
            console.error(e);
        }, {mandatory: {offerToReceiveVideo: true, offerToReceiveAudio: true}});
    };

    self.handleMessage = function (data) {
        var peerConnection = self.createPeerConnection(data.from);
        switch (data.type) {
            case 'sdp-offer':
                peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp), function () {
                    var promise = peerConnection.createAnswer();
                    promise.then(function (sdp) {
                        peerConnection.setLocalDescription(sdp);
                        self.socket.emit('webrtc.message', {from: USER_ID, to: data.from, sdp: sdp, type: 'sdp-answer'});
                    });
                }, function (e) {console.log(e)});
                break;
            case 'sdp-answer':
                peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp), function () {}, function(e) {
                    console.error(e);
                });
                break;
            case 'ice':
                if (data.ice) {
                    peerConnection.addIceCandidate(new RTCIceCandidate(data.ice));
                }
                break;
        }
    };

    navigator.getUserMedia({video: true, audio: true}, function (s) {
        self.gotStream(s);
        video = true;
        audio = true;
    }, function (e) {
        console.error(e);
        navigator.getUserMedia({video: false, audio: true}, function (s) {
            self.gotStream(s);
            video = false;
            audio = false;
        }, function(e) {
            console.error(e);
        });
    });

    self.gotStream = function (s) {
        stream = s;
        $('#local-video').attr('src', URL.createObjectURL(stream));
        if (waitingPeers.length > 0) {
            for (var i in waitingPeers) {
                if ( ! waitingPeers[i].handled) {
                    self.makeOffer(waitingPeers[i].id);
                    waitingPeers[i].handled = true;
                }
            }
            waitingPeers = waitingPeers.filter(function (peer) { return ! peer.handled; });
        }
        if (waitingOffers.length > 0) {
            for (var i in waitingOffers) {
                if ( ! waitingOffers[i].handled) {
                    self.handleMessage(waitingOffers[i].message);
                    waitingOffers[i].handled = true;
                }
            }
            waitingOffers = waitingOffers.filter(function (offer) { return ! offer.handled; });
        }
    };

    self.escapeHtml = function (str) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    };

    toastr.options = {
        "closeButton": false,
        "debug": false,
        "newestOnTop": true,
        "progressBar": false,
        "positionClass": "toast-bottom-left",
        "preventDuplicates": false,
        "onclick": null,
        "showDuration": "300",
        "hideDuration": "1000",
        "timeOut": "5000",
        "extendedTimeOut": "1000",
        "showEasing": "swing",
        "hideEasing": "linear",
        "showMethod": "fadeIn",
        "hideMethod": "fadeOut"
    };

});
