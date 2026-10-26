import { useEffect, useRef } from "react";
import { dictation_analyser } from "../../state/dictation.ts";
import { audio_level, bar_height, bar_x, signal_rms, wave } from "./dictation-wave.ts";

export const DictationWave = () => {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const node = canvas.current;
    const analyser = dictation_analyser();
    const context = node?.getContext("2d");
    if (!node || !analyser || !context) {
      return;
    }
    const ratio = window.devicePixelRatio || 1;
    node.width = Math.round(wave.width * ratio);
    node.height = Math.round(wave.height * ratio);
    const color = getComputedStyle(node).color;
    const samples = new Float32Array(analyser.fftSize);
    const visible = Math.ceil(wave.width / wave.pitch) + 1;
    const bars: number[] = [];
    let step_start = performance.now();
    let sum = 0;
    let count = 0;
    let frame = 0;

    const fill_bar = (x: number, level: number) => {
      const height = bar_height(level);
      context.beginPath();
      context.roundRect(x, (wave.height - height) / 2, wave.bar, height, wave.radius);
      context.fill();
    };

    const draw = (now: number) => {
      analyser.getFloatTimeDomainData(samples);
      sum += audio_level(signal_rms(samples));
      count += 1;
      if (now - step_start >= wave.step_ms) {
        bars.unshift(sum / count);
        bars.length = Math.min(bars.length, visible);
        step_start = now;
        sum = 0;
        count = 0;
      }
      const progress = Math.min(1, (now - step_start) / wave.step_ms);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, wave.width, wave.height);
      context.fillStyle = color;
      fill_bar(bar_x(-1, progress), count > 0 ? sum / count : 0);
      bars.forEach((level, age) => fill_bar(bar_x(age, progress), level));
      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return <canvas ref={canvas} className="dictation-wave" aria-hidden="true" />;
};
