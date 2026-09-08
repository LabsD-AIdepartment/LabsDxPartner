'use client';
import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import styles from './shell.module.css';
/** A separately approved audio source is optional. The toggle reports playback, not just intent. */
export function MusicToggle({ source }: { source?: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [enabled, setEnabled] = useState(true);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem('labsd-music') === 'muted') setEnabled(false);
    } catch {}
  }, []);
  useEffect(() => {
    const audio = ref.current;
    if (!audio || !source) return;
    if (!enabled) {
      audio.pause();
      return;
    }
    audio.volume = 0.2;
    const play = () => {
      void audio.play().catch(() => setPlaying(false));
    };
    play();
    window.addEventListener('pointerdown', play, { once: true });
    return () => {
      window.removeEventListener('pointerdown', play);
      audio.pause();
    };
  }, [source, enabled]);
  const toggle = () => {
    const next = !enabled || !playing;
    setEnabled(next);
    try {
      localStorage.setItem('labsd-music', next ? 'enabled' : 'muted');
    } catch {}
    if (next) void ref.current?.play().catch(() => setPlaying(false));
    else ref.current?.pause();
  };
  return (
    <div className={styles.music}>
      {source && (
        <audio
          ref={ref}
          src={source}
          loop
          preload="none"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => setPlaying(false)}
        />
      )}
      <Button
        icon
        disabled={!source}
        aria-label={
          !source
            ? 'ยังไม่ได้ตั้งค่าเพลงพื้นหลัง'
            : playing
              ? 'ปิดเสียงเพลงพื้นหลัง'
              : 'เปิดเสียงเพลงพื้นหลัง'
        }
        onClick={toggle}
      >
        {playing ? <Volume2 size={18} /> : <VolumeX size={18} />}
      </Button>
    </div>
  );
}
