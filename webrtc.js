/**
 * webrtc.js
 * -----------------------------------------------------------------------
 * Peer-to-peer LIVE VIDEO CALL for Conversation mode -- lets the two
 * phones see and hear each other the whole time they're in the same
 * room, on top of the existing sign-to-text messaging (room.js).
 *
 * This uses your free Firebase project only as a "phone book" -- a place
 * for the two phones to briefly exchange some connection info (called an
 * "offer", an "answer", and a list of "ICE candidates"). Once that
 * exchange finishes, the actual video and audio travel DIRECTLY between
 * the two phones (via the internet, using free Google STUN servers to
 * help find a path through home/mobile routers) -- Firebase never sees
 * or stores the video itself, only that small handshake.
 *
 * This is the standard WebRTC "offer/answer" pattern. Whoever tapped
 * "Start a Conversation" is the CALLER (creates the offer); whoever
 * tapped "Join a Conversation" is the CALLEE (creates the answer).
 *
 * Honest limitation: this only uses free STUN servers, not a TURN
 * server (a paid relay some strict networks require). On most home
 * wifi and mobile data this connects fine. On a strict school/office
 * network -- the same kind that can block the MediaPipe/Firebase CDNs
 * elsewhere in this project -- the video call specifically may fail to
 * connect even though everything else (Practice mode, sign-to-text
 * messages) keeps working, since those don't need this same kind of
 * connection. Please test on the actual wifi/data you'll use for your
 * demo ahead of time.
 */

import {
  setSignal, pushSignal, listenSignalValue, listenSignalChildren,
} from './room.js';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/**
 * Starts (caller) or joins (callee) a peer-to-peer video/audio call for
 * a room.
 *
 * @param {string} code               the 4-digit room code
 * @param {boolean} isCaller          true for whoever created the room
 * @param {MediaStream} localStream   this phone's own camera+mic stream to send
 * @param {{onRemoteStream?: (stream: MediaStream) => void, onState?: (state: string) => void}} callbacks
 * @returns {Promise<{close: () => void}>} call `.close()` to hang up and release the camera/mic
 */
export async function startCall(code, isCaller, localStream, callbacks = {}) {
  const { onRemoteStream, onState } = callbacks;

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const unsubscribers = [];
  let pendingCandidates = [];

  async function flushPendingCandidates() {
    const queued = pendingCandidates;
    pendingCandidates = [];
    for (const candidate of queued) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn('[webrtc] addIceCandidate (queued) failed', err);
      }
    }
  }

  async function addRemoteCandidate(candidate) {
    if (pc.remoteDescription && pc.remoteDescription.type) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn('[webrtc] addIceCandidate failed', err);
      }
    } else {
      // Remote description isn't set yet -- save it and add it once it is,
      // otherwise the browser rejects it.
      pendingCandidates.push(candidate);
    }
  }

  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  pc.ontrack = (event) => {
    if (onRemoteStream && event.streams && event.streams[0]) {
      onRemoteStream(event.streams[0]);
    }
  };

  pc.onconnectionstatechange = () => {
    if (onState) onState(pc.connectionState);
  };

  const myCandidatesPath = isCaller ? 'callerCandidates' : 'calleeCandidates';
  const theirCandidatesPath = isCaller ? 'calleeCandidates' : 'callerCandidates';

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      pushSignal(code, myCandidatesPath, event.candidate.toJSON()).catch((err) => {
        console.warn('[webrtc] could not send an ICE candidate', err);
      });
    }
  };

  if (isCaller) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await setSignal(code, 'offer', { type: offer.type, sdp: offer.sdp });

    const unsubAnswer = await listenSignalValue(code, 'answer', async (answer) => {
      if (answer && !pc.currentRemoteDescription) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        await flushPendingCandidates();
      }
    });
    unsubscribers.push(unsubAnswer);
  } else {
    const unsubOffer = await listenSignalValue(code, 'offer', async (offer) => {
      if (offer && !pc.currentRemoteDescription) {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        await flushPendingCandidates();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await setSignal(code, 'answer', { type: answer.type, sdp: answer.sdp });
      }
    });
    unsubscribers.push(unsubOffer);
  }

  const unsubTheirCandidates = await listenSignalChildren(code, theirCandidatesPath, (candidate) => {
    addRemoteCandidate(candidate);
  });
  unsubscribers.push(unsubTheirCandidates);

  return {
    close() {
      unsubscribers.forEach((unsub) => {
        try { unsub(); } catch (err) { /* already gone -- fine */ }
      });
      try {
        pc.getSenders().forEach((sender) => {
          if (sender.track) sender.track.stop();
        });
      } catch (err) { /* ignore */ }
      try { pc.close(); } catch (err) { /* ignore */ }
    },
  };
}
