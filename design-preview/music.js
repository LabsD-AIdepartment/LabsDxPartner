/* One audio toggle shared by all dashboard pages. */
(() => {
  const button = document.getElementById('music-launcher');
  const mount = document.getElementById('music-player');
  const wave = document.getElementById('music-wave');
  const slash = document.getElementById('music-slash');
  let player;
  let ready = false;
  let muted = false;
  let loading = false;
  let awaitingInteraction = true;
  let timer;

  function render() {
    button.setAttribute('aria-pressed', String(muted));
    button.setAttribute('aria-label', loading ? 'กำลังโหลดเพลง' : muted ? 'เปิดเสียงเพลง' : 'ปิดเสียงเพลง');
    button.setAttribute('title', loading ? 'กำลังโหลดเพลง' : muted ? 'เปิดเสียงเพลง' : awaitingInteraction ? 'เปิดเสียงแล้ว · แตะหน้าเว็บเพื่อเริ่มเพลง' : 'ปิดเสียงเพลง');
    button.setAttribute('aria-busy', String(loading));
    button.classList.toggle('music-on', !muted && !loading);
    wave.style.display = muted ? 'none' : '';
    slash.style.display = muted ? '' : 'none';
  }

  function failed() {
    clearTimeout(timer);
    player?.destroy();
    player = undefined;
    ready = false;
    loading = false;
    muted = true;
    render();
    button.title = 'โหลดเพลงไม่สำเร็จ กดเพื่อลองอีกครั้ง';
  }

  function createPlayer() {
    if (!loading) return;
    mount.replaceChildren(Object.assign(document.createElement('div'), { id: 'background-music' }));
    player = new YT.Player('background-music', {
      width: 200, height: 200, videoId: 'E6NpWspc8x8',
      playerVars: { autoplay: 1, playsinline: 1, loop: 1, playlist: 'E6NpWspc8x8', origin: location.origin },
      events: {
        onReady(event) {
          clearTimeout(timer);
          ready = true;
          loading = false;
          event.target.setVolume(25);
          if (muted) event.target.mute(); else event.target.unMute();
          event.target.playVideo();
          render();
        },
        onAutoplayBlocked() {
          loading = false;
          awaitingInteraction = true;
          render();
        },
        onStateChange(event) {
          if (event.data === YT.PlayerState.PLAYING) awaitingInteraction = false;
          render();
        },
        onError: failed
      }
    });
  }

  function start() {
    loading = true;
    awaitingInteraction = true;
    render();
    timer = setTimeout(failed, 20000);
    if (window.YT?.Player) createPlayer();
    else {
      window.onYouTubeIframeAPIReady = createPlayer;
      document.getElementById('youtube-music-api')?.remove();
      const script = document.createElement('script');
      script.id = 'youtube-music-api';
      script.src = 'https://www.youtube.com/iframe_api';
      script.onerror = failed;
      document.head.append(script);
    }
  }

  button.addEventListener('click', () => {
    if (loading) {
      muted = !muted;
      render();
      return;
    }
    if (ready) {
      muted = !muted;
      if (muted) player.mute();
      else { player.unMute(); player.playVideo(); }
      render();
      return;
    }
    muted = false;
    start();
  });

  function resumeOnInteraction(event) {
    if (!event.isTrusted || button.contains(event.target) || muted || !ready || !awaitingInteraction) return;
    player.unMute();
    player.playVideo();
  }
  document.addEventListener('pointerdown', resumeOnInteraction);
  document.addEventListener('keydown', resumeOnInteraction);
  start();
})();
