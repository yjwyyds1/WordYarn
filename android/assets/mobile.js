(() => {
  'use strict';
  window.wordYarnAndroid = {};
  document.documentElement.classList.add('android-app');
  let sequence = 0, current = null, paused = false;
  const start = utterance => {
    current = { id: ++sequence, utterance };
    AndroidSpeech.speak(String(current.id), utterance.text.slice(0, 1800), utterance.rate, utterance.volume);
  };
  window.wordYarnSpeechEvent = (id, event, from, end) => {
    if (!current || id !== current.id) return;
    const { utterance } = current;
    if (event === 'end' || event === 'error') current = null;
    utterance['on' + event]?.({ charIndex: from, charLength: end - from,
      error: 'bundled-voice-error' });
  };
  window.wordYarnAndroid.synthesis = {
    get paused() { return paused; },
    getVoices: () => [{ name: 'Kokoro · 内置离线音色', lang: 'en-US', voiceURI: 'wordyarn-kokoro', localService: true }],
    addEventListener() {},
    speak(utterance) { paused = false; start(utterance); },
    pause() {
      if (!current || paused) return;
      paused = true;
      AndroidSpeech.pause();
    },
    resume() {
      if (!paused) return;
      paused = false;
      if (current) AndroidSpeech.resume();
    },
    cancel() {
      if (current) AndroidSpeech.stop();
      current = null;
      paused = false;
    }
  };
  window.wordYarnAndroid.Utterance = function (text) {
    this.text = text;
    this.rate = 1;
    this.volume = 1;
  };
})();
