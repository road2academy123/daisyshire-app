const CALL_TIMEOUT_MS = 45000;

const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

export function createDaisyshireCallController({
  supabase,
  getCurrentUser,
  getConversationId,
  getOtherProfile
}) {
  let channel = null;
  let peer = null;
  let localStream = null;
  let remoteStream = null;
  let activeCallId = null;
  let callRole = null;
  let callState = 'idle';
  let pendingCandidates = [];
  let callTimer = null;
  let remoteUserId = null;
  let destroyed = false;

  const root = document.createElement('section');
  root.id = 'daisyCallOverlay';
  root.className = 'daisy-call-overlay';
  root.hidden = true;

  root.innerHTML = `
    <div class="daisy-call-card">
      <div class="daisy-heart-decor" aria-hidden="true">
        <span>♡</span>
        <span>♥</span>
        <span>✧</span>
        <span>♡</span>
        <span>✦</span>
        <span>♥</span>
      </div>

      <div class="daisy-call-top">
        <span class="daisy-call-brand">DAISYSHIRE VIDEO</span>
        <button type="button" id="daisyCallClose" aria-label="Close call">×</button>
      </div>

      <div class="daisy-call-status" id="daisyCallStatus">
        Video calling
      </div>

      <div class="daisy-call-videos">
        <video id="daisyRemoteVideo" autoplay playsinline></video>
        <video id="daisyLocalVideo" autoplay playsinline muted></video>
      </div>

      <div class="daisy-call-actions" id="daisyCallActions">
        <button type="button" id="daisyAcceptCall">Accept</button>
        <button type="button" id="daisyRejectCall">Reject</button>
      </div>

      <div class="daisy-call-controls" id="daisyCallControls" hidden>
        <button type="button" id="daisyMuteCall">Mute</button>
        <button type="button" id="daisyCameraCall">Camera off</button>
        <button type="button" id="daisySwitchCamera">Switch camera</button>
        <button type="button" id="daisyEndCall">End call</button>
      </div>
    </div>
  `;

  document.body.appendChild(root);

  const $ = id => root.querySelector('#' + id);

  function setStatus(message) {
    $('daisyCallStatus').textContent = message;
  }

  function showOverlay() {
    root.hidden = false;
  }

  function hideOverlay() {
    root.hidden = true;
  }

  function setButtons(mode) {
    $('daisyCallActions').hidden = mode !== 'incoming';
    $('daisyCallControls').hidden = mode !== 'active';
  }

  function stopTimer() {
    if (callTimer) clearTimeout(callTimer);
    callTimer = null;
  }

  function stopMedia() {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }

    if (remoteStream) {
      remoteStream.getTracks().forEach(track => track.stop());
    }

    localStream = null;
    remoteStream = null;

    $('daisyLocalVideo').srcObject = null;
    $('daisyRemoteVideo').srcObject = null;
  }

  function closePeer() {
    if (peer) {
      peer.ontrack = null;
      peer.onicecandidate = null;
      peer.onconnectionstatechange = null;
      peer.close();
    }

    peer = null;
    pendingCandidates = [];
  }

  function resetCall() {
    stopTimer();
    closePeer();
    stopMedia();

    activeCallId = null;
    callRole = null;
    callState = 'idle';
    remoteUserId = null;

    setButtons('none');
    hideOverlay();
  }

  async function sendSignal(kind, extra = {}) {
    if (!channel || !activeCallId) return;

    const user = getCurrentUser();
    const conversation = getConversationId();

    if (!user || !conversation || !remoteUserId) return;

    const result = await channel.send({
      type: 'broadcast',
      event: 'call-signal',
      payload: {
        kind,
        callId: activeCallId,
        conversationId: conversation,
        from: user.id,
        to: remoteUserId,
        ...extra
      }
    });

    if (result !== 'ok') {
      console.warn('Daisyshire call signal was not acknowledged:', result);
    }
  }

  async function ensureLocalMedia() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        'Camera and microphone are unavailable. Open Daisyshire over HTTPS in a supported browser.'
      );
    }

    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });

    $('daisyLocalVideo').srcObject = localStream;
    return localStream;
  }

  function createPeer() {
    closePeer();

    peer = new RTCPeerConnection({
      iceServers: STUN_SERVERS
    });

    remoteStream = new MediaStream();
    $('daisyRemoteVideo').srcObject = remoteStream;

    localStream.getTracks().forEach(track => {
      peer.addTrack(track, localStream);
    });

    peer.ontrack = event => {
      event.streams[0]?.getTracks().forEach(track => {
        if (!remoteStream.getTracks().some(existing => existing.id === track.id)) {
          remoteStream.addTrack(track);
        }
      });

      $('daisyRemoteVideo').play().catch(() => {});
    };

    peer.onicecandidate = event => {
      if (event.candidate) {
        sendSignal('ice-candidate', {
          candidate: event.candidate.toJSON()
        }).catch(console.error);
      }
    };

    peer.onconnectionstatechange = () => {
      if (!peer) return;

      if (peer.connectionState === 'connected') {
        callState = 'active';
        setStatus('Connected');
        setButtons('active');
      } else if (peer.connectionState === 'connecting') {
        setStatus('Connecting video…');
      } else if (peer.connectionState === 'disconnected') {
        setStatus('Connection interrupted…');
      } else if (peer.connectionState === 'failed') {
        setStatus('Connection failed. Please try again.');
      }
    };
  }

  async function applyPendingCandidates() {
    if (!peer?.remoteDescription) return;

    const candidates = pendingCandidates;
    pendingCandidates = [];

    for (const candidate of candidates) {
      try {
        await peer.addIceCandidate(candidate);
      } catch (error) {
        console.warn('Could not add an ICE candidate:', error);
      }
    }
  }

  async function receiveSignal(payload) {
    const user = getCurrentUser();

    if (!user || payload.to !== user.id || payload.from === user.id) return;
    if (payload.conversationId !== getConversationId()) return;

    if (payload.kind === 'invite') {
      if (callState !== 'idle') {
        const user = getCurrentUser();

        if (user && channel) {
          await channel.send({
            type: 'broadcast',
            event: 'call-signal',
            payload: {
              kind: 'busy',
              callId: payload.callId,
              conversationId: payload.conversationId,
              from: user.id,
              to: payload.from
            }
          });
        }

        return;
      }

      activeCallId = payload.callId;
      remoteUserId = payload.from;
      callRole = 'receiver';
      callState = 'incoming';

      showOverlay();
      setButtons('incoming');
      setStatus('Incoming video call');

      callTimer = setTimeout(() => {
        if (callState === 'incoming') {
          sendSignal('reject').catch(console.error);
          resetCall();
        }
      }, CALL_TIMEOUT_MS);

      return;
    }

    if (!activeCallId || payload.callId !== activeCallId) return;

    if (payload.kind === 'accept' && callRole === 'caller') {
      stopTimer();
      setStatus('Preparing video…');
      setButtons('active');

      try {
        createPeer();

        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);

        await sendSignal('offer', {
          description: peer.localDescription.toJSON()
        });
      } catch (error) {
        console.error(error);
        setStatus(error.message || 'Could not start the call.');
        await endCall();
      }

      return;
    }

    if (payload.kind === 'offer' && callRole === 'receiver') {
      try {
        await peer.setRemoteDescription(payload.description);
        await applyPendingCandidates();

        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);

        await sendSignal('answer', {
          description: peer.localDescription.toJSON()
        });

        setStatus('Connecting video…');
      } catch (error) {
        console.error(error);
        setStatus('Could not establish the call.');
        await endCall();
      }

      return;
    }

    if (payload.kind === 'answer' && callRole === 'caller') {
      try {
        await peer.setRemoteDescription(payload.description);
        await applyPendingCandidates();
      } catch (error) {
        console.error(error);
        setStatus('Could not connect the call.');
        await endCall();
      }

      return;
    }

    if (payload.kind === 'ice-candidate') {
      if (!peer || !payload.candidate) return;

      if (peer.remoteDescription) {
        try {
          await peer.addIceCandidate(payload.candidate);
        } catch (error) {
          console.warn('ICE candidate could not be added:', error);
        }
      } else {
        pendingCandidates.push(payload.candidate);
      }

      return;
    }

    if (payload.kind === 'reject') {
      setStatus('Call declined');
      setTimeout(() => {
        if (activeCallId === payload.callId) resetCall();
      }, 1200);
      return;
    }

    if (payload.kind === 'busy') {
      setStatus('The other person is already on a call.');
      setTimeout(() => {
        if (activeCallId === payload.callId) resetCall();
      }, 1800);
      return;
    }

    if (payload.kind === 'end') {
      setStatus('Call ended');
      setTimeout(() => {
        if (activeCallId === payload.callId) resetCall();
      }, 700);
    }
  }

  async function startSignaling() {
    const conversation = getConversationId();
    const user = getCurrentUser();

    if (!conversation || !user || destroyed) return;

    if (channel) {
      await supabase.removeChannel(channel);
      channel = null;
    }

    channel = supabase.channel(
      'daisyshire-call:' + conversation,
      { config: { private: true } }
    );

    channel.on(
      'broadcast',
      { event: 'call-signal' },
      ({ payload }) => {
        receiveSignal(payload).catch(error => {
          console.error('Daisyshire call signal error:', error);
        });
      }
    );

    await new Promise((resolve, reject) => {
      channel.subscribe(status => {
        if (status === 'SUBSCRIBED') resolve();
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          reject(new Error('Could not connect to the video-call service.'));
        }
      });
    });
  }

  async function startCall() {
    if (callState !== 'idle' || destroyed) return;

    const user = getCurrentUser();
    const other = getOtherProfile();

    if (!user || !other?.id) {
      alert('The other account is not available right now.');
      return;
    }

    if (!channel) {
      alert('Video calling is still connecting. Please try again.');
      return;
    }

    try {
      activeCallId = crypto.randomUUID();
      remoteUserId = other.id;
      callRole = 'caller';
      callState = 'outgoing';

      showOverlay();
      setButtons('none');
      setStatus('Requesting camera and microphone…');

      await ensureLocalMedia();

      callState = 'ringing';
      setStatus('Calling…');

      await sendSignal('invite');

      callTimer = setTimeout(() => {
        if (callState === 'ringing') {
          setStatus('No answer');
          sendSignal('end').catch(console.error);
          setTimeout(resetCall, 1200);
        }
      }, CALL_TIMEOUT_MS);
    } catch (error) {
      console.error(error);
      alert(error.message || 'Could not start the video call.');
      resetCall();
    }
  }

  async function acceptCall() {
    if (callState !== 'incoming') return;

    stopTimer();
    setStatus('Requesting camera and microphone…');

    try {
      await ensureLocalMedia();
      createPeer();

      callState = 'connecting';
      setButtons('active');
      setStatus('Joining video call…');

      await sendSignal('accept');
    } catch (error) {
      console.error(error);
      alert(error.message || 'Could not access the camera or microphone.');
      await sendSignal('reject').catch(console.error);
      resetCall();
    }
  }

  async function rejectCall() {
    if (callState !== 'incoming') return;

    await sendSignal('reject').catch(console.error);
    resetCall();
  }

  async function endCall() {
    if (callState === 'idle') return;

    await sendSignal('end').catch(console.error);
    resetCall();
  }

  function toggleMute() {
    if (!localStream) return;

    const track = localStream.getAudioTracks()[0];
    if (!track) return;

    track.enabled = !track.enabled;
    $('daisyMuteCall').textContent = track.enabled ? 'Mute' : 'Unmute';
  }

  function toggleCamera() {
    if (!localStream) return;

    const track = localStream.getVideoTracks()[0];
    if (!track) return;

    track.enabled = !track.enabled;
    $('daisyCameraCall').textContent =
      track.enabled ? 'Camera off' : 'Camera on';
  }

  async function switchCamera() {
    if (!localStream || callState === 'idle') return;

    const oldTrack = localStream.getVideoTracks()[0];
    if (!oldTrack) return;

    const currentFacing =
      oldTrack.getSettings().facingMode || 'user';

    let newStream;

    try {
      newStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: {
            ideal: currentFacing === 'user' ? 'environment' : 'user'
          }
        }
      });

      const newTrack = newStream.getVideoTracks()[0];
      const sender = peer?.getSenders().find(
        item => item.track?.kind === 'video'
      );

      if (sender) await sender.replaceTrack(newTrack);

      localStream.removeTrack(oldTrack);
      oldTrack.stop();
      localStream.addTrack(newTrack);

      $('daisyLocalVideo').srcObject = localStream;
    } catch (error) {
      console.error(error);
      alert('Could not switch cameras on this device.');
    }
  }

  $('daisyCallClose').addEventListener('click', endCall);
  $('daisyAcceptCall').addEventListener('click', acceptCall);
  $('daisyRejectCall').addEventListener('click', rejectCall);
  $('daisyEndCall').addEventListener('click', endCall);
  $('daisyMuteCall').addEventListener('click', toggleMute);
  $('daisyCameraCall').addEventListener('click', toggleCamera);
  $('daisySwitchCamera').addEventListener('click', switchCamera);

  async function destroy() {
    destroyed = true;

    if (callState !== 'idle') {
      await sendSignal('end').catch(() => {});
    }

    resetCall();

    if (channel) {
      await supabase.removeChannel(channel);
      channel = null;
    }

    root.remove();
  }

  return {
    startSignaling,
    startCall,
    destroy
  };
}
