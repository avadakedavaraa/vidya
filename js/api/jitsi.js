/**
 * Vidyasetu — Jitsi Meet Service
 * Wraps the Jitsi External API for reuse across the app.
 *
 * Fix notes:
 *  - parentNode now accepts either a CSS selector string OR a DOM element
 *  - Room name is always deterministic from sessionId (never random if ID is present)
 *  - expose `roomName` so the page can display / debug it
 */
export const jitsi = {
  api:      null,
  roomName: null,

  /**
   * @param {string|Element} container  CSS selector OR actual DOM element
   * @param {string|null}    sessionId  The Supabase session ID (must match for both users)
   * @param {string}         userName   Display name shown inside Jitsi
   * @param {object}         events     Callbacks: onMuteChanged, onParticipantLeft, onParticipantJoined, onMessageReceived
   */
  init(container, sessionId, userName, events = {}) {
    // Guard: Jitsi external API script must be loaded
    if (typeof JitsiMeetExternalAPI === 'undefined') {
      console.error('[jitsi.js] JitsiMeetExternalAPI not found — did <script src="https://meet.jit.si/external_api.js"> load?');
      return null;
    }

    // Resolve container to a DOM element
    const parentNode = (typeof container === 'string')
      ? document.querySelector(container)
      : container;

    if (!parentNode) {
      console.error('[jitsi.js] Container not found:', container);
      return null;
    }

    // ⚠️  CRITICAL: Both student AND teacher MUST derive the SAME room name.
    //    We use the Supabase session ID so that is guaranteed.
    //    Never use Math.random() when a sessionId exists.
    this.roomName = sessionId
      ? 'VidyasetuSession' + sessionId.replace(/-/g, '')   // alphanumeric only — Jitsi requirement
      : 'VidyasetuPreview' + Date.now();                    // isolated preview (no real session)

    const domain = 'meet.jit.si';
    const options = {
      roomName: this.roomName,
      width:    '100%',
      height:   '100%',
      parentNode,
      userInfo: {
        displayName: userName || 'Student',
      },
      configOverwrite: {
        startWithAudioMuted:  false,
        startWithVideoMuted:  false,
        prejoinPageEnabled:   false,
        // Ensure local video is mirrored nicely
        localRecording:       { disable: true },
        // Disable pre-call test page
        enableWelcomePage:    false,
      },
      interfaceConfigOverwrite: {
        // Hide Jitsi's own toolbar — we have our own controls
        TOOLBAR_BUTTONS: [],
        // Suppress Jitsi's watermark / branding
        SHOW_JITSI_WATERMARK:      false,
        SHOW_WATERMARK_FOR_GUESTS: false,
        SHOW_BRAND_WATERMARK:      false,
        BRAND_WATERMARK_LINK:      '',
        DEFAULT_LOGO_URL:          '',
        HIDE_INVITE_MORE_HEADER:   true,
      },
    };

    console.log('[jitsi.js] Joining room:', this.roomName, '| user:', userName);
    this.api = new JitsiMeetExternalAPI(domain, options);

    // Attach event listeners
    if (events.onMuteChanged)     this.api.addEventListener('audioMuteStatusChanged', events.onMuteChanged);
    if (events.onParticipantLeft) this.api.addEventListener('participantLeft',          events.onParticipantLeft);
    if (events.onParticipantJoined) this.api.addEventListener('participantJoined',     events.onParticipantJoined);
    if (events.onMessageReceived) this.api.addEventListener('endpointTextMessageReceived', events.onMessageReceived);

    // Surface video-conference errors
    this.api.addEventListener('errorOccurred', (err) => {
      console.error('[jitsi.js] Error:', err);
    });

    return this.api;
  },

  executeCommand(command, ...args) {
    if (this.api) this.api.executeCommand(command, ...args);
    else console.warn('[jitsi.js] executeCommand called before init:', command);
  },

  toggleMic()      { this.executeCommand('toggleAudio'); },
  toggleCam()      { this.executeCommand('toggleVideo'); },
  toggleScreen()   { this.executeCommand('toggleShareScreen'); },
  toggleRaiseHand(){ this.executeCommand('toggleRaiseHand'); },
  toggleBlur()     { this.executeCommand('toggleBackgroundBlur'); },
  toggleTileView() { this.executeCommand('toggleTileView'); },

  dispose() {
    if (this.api) {
      this.api.dispose();
      this.api      = null;
      this.roomName = null;
    }
  },
};
