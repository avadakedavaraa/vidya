export const jitsi = {
  api: null,
  
  init(containerId, sessionId, userName, events = {}) {
    if (typeof JitsiMeetExternalAPI === 'undefined') {
      console.error("Jitsi script not loaded");
      return;
    }
    
    const domain = 'meet.jit.si';
    const options = {
      roomName: 'Vidyasetu-Session-' + (sessionId || 'Preview' + Math.floor(Math.random() * 1000)),
      width: '100%',
      height: '100%',
      parentNode: document.querySelector(containerId),
      userInfo: {
        displayName: userName || "You"
      },
      configOverwrite: { 
        startWithAudioMuted: false, 
        startWithVideoMuted: false,
        prejoinPageEnabled: false
      },
      interfaceConfigOverwrite: {
        TOOLBAR_BUTTONS: [] // Hide default toolbar
      }
    };
    
    this.api = new JitsiMeetExternalAPI(domain, options);
    
    // Setup listeners
    if (events.onMuteChanged) this.api.addEventListener('audioMuteStatusChanged', events.onMuteChanged);
    if (events.onParticipantLeft) this.api.addEventListener('participantLeft', events.onParticipantLeft);
    if (events.onParticipantJoined) this.api.addEventListener('participantJoined', events.onParticipantJoined);
    if (events.onMessageReceived) this.api.addEventListener('endpointTextMessageReceived', events.onMessageReceived);
    
    return this.api;
  },
  
  executeCommand(command, ...args) {
    if (this.api) {
      this.api.executeCommand(command, ...args);
    }
  },
  
  toggleMic() { this.executeCommand('toggleAudio'); },
  toggleCam() { this.executeCommand('toggleVideo'); },
  toggleScreen() { this.executeCommand('toggleShareScreen'); },
  toggleRaiseHand() { this.executeCommand('toggleRaiseHand'); },
  toggleBlur() { this.executeCommand('toggleBackgroundBlur'); },
  toggleTileView() { this.executeCommand('toggleTileView'); },
  
  dispose() {
    if (this.api) {
      this.api.dispose();
      this.api = null;
    }
  }
};
