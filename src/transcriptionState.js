/**
 * Runtime toggle for live transcription (Deepgram). When disabled, voice is not sent to Deepgram.
 */

let liveTranscriptionEnabled = true;

export function isLiveTranscriptionEnabled() {
  return liveTranscriptionEnabled;
}

export function setLiveTranscriptionEnabled(enabled) {
  liveTranscriptionEnabled = !!enabled;
}

export function getTranscriptionState() {
  return { enabled: liveTranscriptionEnabled };
}
