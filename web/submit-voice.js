(function () {
  let unlocked = false;
  function unlock() {
    unlocked = true;
    document.removeEventListener('pointerdown', unlock);
    document.removeEventListener('keydown', unlock);
  }
  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });
  window.speakSubmitSuccess = function () {
    if (!unlocked || !('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return false;
    try {
      const utterance = new SpeechSynthesisUtterance('提交成功，下一个');
      utterance.lang = 'zh-CN';
      utterance.rate = 0.9;
      utterance.volume = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
      return true;
    } catch (_) {
      return false;
    }
  };
})();
