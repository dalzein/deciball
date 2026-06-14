import { useEffect, useRef } from "react";
import styles from "./App.module.css";
import audio from "./assets/royalty.mp3";
import Uploader from "./components/Uploader/Uploader";

type RingPoint = {
  angle: number;
  x: number;
  y: number;
  distanceFactor: number;
};

type Particle = {
  x: number;
  y: number;
  size: number;
  opacity: number;
  angle: number;
  speed: number;
  hue: number;
};

type ParticleCoordinates = {
  particleCoordinateArray: Particle[];
  angle: number;
};

type Shockwave = {
  radius: number;
  opacity: number;
  hue: number;
  width: number;
};

type Star = {
  x: number;
  y: number;
  size: number;
  baseOpacity: number;
  twinkle: number;
};

const totalRingPoints = 48;
const binsToSkip = 2;
const frequencyArray = new Float32Array(totalRingPoints / 2 + binsToSkip + 1);

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext>(
    new AudioContext({ sampleRate: 44100 })
  );
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  useEffect(() => {
    const audioElement = audioRef.current;

    if (!audioElement) return;

    if (!audioSourceRef.current) {
      audioSourceRef.current =
        audioContextRef.current.createMediaElementSource(audioElement);

      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 8192;
      audioSourceRef.current.connect(analyserRef.current);
      analyserRef.current.connect(audioContextRef.current.destination);
    }
  }, []);

  // User interaction is needed before we can resume the audio context
  useEffect(() => {
    const resumeAudioContext = () => {
      if (audioContextRef.current?.state === "suspended") {
        audioContextRef.current.resume();
      }
    };

    document.addEventListener("touchend", resumeAudioContext);
    document.addEventListener("click", resumeAudioContext);

    return () => {
      document.removeEventListener("touchend", resumeAudioContext);
      document.removeEventListener("click", resumeAudioContext);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Full-resolution buffer holding the freshly drawn, sharp colour frame.
    const sceneCanvas = document.createElement("canvas");
    const sceneCtx = sceneCanvas.getContext("2d")!;

    // Tiny buffer holding a heavily downscaled copy of the scene, blitted back
    // upscaled to produce a cheap blur/bloom.
    const glowScale = 0.13;
    const glowCanvas = document.createElement("canvas");
    const glowCtx = glowCanvas.getContext("2d")!;

    // Pixelation buffers, all at the low "chunky pixel" resolution. The frame
    // (sharp scene + bloom) is assembled in `frameCanvas`, then split into RGB
    // channels (via `chScratchCanvas`) and recombined with an offset into
    // `abCanvas` for the chromatic aberration. Finally it is composited onto the
    // persistent `pixelCanvas` (which holds the motion-trail history) and that
    // is nearest-neighbour upscaled to the screen for the arcade / 8-bit look.
    const pixelSize = 6; // device px per chunky pixel
    const frameCanvas = document.createElement("canvas");
    const chScratchCanvas = document.createElement("canvas");
    const abCanvas = document.createElement("canvas");
    const pixelCanvas = document.createElement("canvas");
    const frameCtx = frameCanvas.getContext("2d")!;
    const chScratchCtx = chScratchCanvas.getContext("2d")!;
    const abCtx = abCanvas.getContext("2d")!;
    const pixelCtx = pixelCanvas.getContext("2d")!;

    const ringCoordinates: RingPoint[] = [];
    const particleCoordinates: ParticleCoordinates[] = [];
    const shockwaves: Shockwave[] = [];
    let stars: Star[] = [];

    let radius = Math.min(canvas.width, canvas.height) / 4;
    let currentLoudness = 0;

    // Smoothed/derived signals used purely for the visuals (they never feed
    // back into the bass extraction maths below).
    let smoothLoudness = 0; // slow average, the "floor" we measure hits against
    let bassPunch = 0; // how far above the floor we currently are (the transient)
    let smoothPunch = 0; // eased punch, so colour/brightness don't strobe
    let aberration = 0; // fast-attack/slow-decay envelope driving the RGB split
    let hue = 265; // base hue, slowly drifts over time
    let time = 0;
    let lastShockTime = -1000;

    // Build a starfield scaled to the viewport for a sense of depth
    const seedStars = () => {
      const count = Math.round((canvas.width * canvas.height) / 11000);
      stars = [];
      for (let i = 0; i < count; i++) {
        stars.push({
          x: Math.random(),
          y: Math.random(),
          size: Math.pow(Math.random(), 2.5) * 1.6 + 0.2,
          baseOpacity: Math.random() * 0.5 + 0.1,
          twinkle: Math.random() * Math.PI * 2,
        });
      }
    };

    for (let angle = 90; angle < 450; angle += 1) {
      particleCoordinates.push({
        particleCoordinateArray: [],
        angle: angle,
      });
    }

    for (let angle = 90; angle < 450; angle += 360 / totalRingPoints) {
      const pointData = JSON.stringify({
        angle: angle,
        x: (canvas.width / 2) * Math.cos((-angle * Math.PI) / 180),
        y: (canvas.height / 2) * Math.sin((-angle * Math.PI) / 180),
        distanceFactor: 1,
      });

      ringCoordinates.push(JSON.parse(pointData));
    }

    const resize = () => {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      sceneCanvas.width = canvas.width;
      sceneCanvas.height = canvas.height;
      glowCanvas.width = Math.max(1, Math.round(canvas.width * glowScale));
      glowCanvas.height = Math.max(1, Math.round(canvas.height * glowScale));
      const pw = Math.max(1, Math.round(canvas.width / pixelSize));
      const ph = Math.max(1, Math.round(canvas.height / pixelSize));
      frameCanvas.width = chScratchCanvas.width = abCanvas.width =
        pixelCanvas.width = pw;
      frameCanvas.height = chScratchCanvas.height = abCanvas.height =
        pixelCanvas.height = ph;
      radius = Math.min(canvas.width, canvas.height) / 4;
      seedStars();
    };
    resize();

    const renderStars = () => {
      for (const star of stars) {
        const flicker =
          star.baseOpacity *
          (0.6 + 0.4 * Math.sin(time * 0.002 + star.twinkle));
        sceneCtx.beginPath();
        sceneCtx.arc(
          star.x * canvas.width,
          star.y * canvas.height,
          star.size,
          0,
          2 * Math.PI
        );
        sceneCtx.fillStyle = `hsl(${hue + 30} 40% 90% / ${flicker})`;
        sceneCtx.fill();
      }
    };

    // Draw the flying particles as comet streaks: a gradient tapering from a
    // transparent tail to a bright head, its length following the particle's
    // velocity (so they stretch out as the bass speeds them up). Their soft
    // glow comes from the bloom pass rather than a per-particle shadowBlur.
    const trailFrames = 6; // how many frames of motion the tail spans
    const renderParticles = () => {
      sceneCtx.lineCap = "round";
      particleCoordinates.forEach((position) => {
        position.particleCoordinateArray.forEach((particle) => {
          const vx =
            Math.cos((-particle.angle * Math.PI) / 180) * particle.speed;
          const vy =
            Math.sin((-particle.angle * Math.PI) / 180) * particle.speed;
          const tailX = particle.x - vx * trailFrames;
          const tailY = particle.y - vy * trailFrames;

          // Too slow to streak meaningfully → just a dot
          if (Math.hypot(vx, vy) * trailFrames < particle.size) {
            sceneCtx.beginPath();
            sceneCtx.arc(particle.x, particle.y, particle.size, 0, 2 * Math.PI);
            sceneCtx.fillStyle = `hsl(${particle.hue} 100% 78% / ${particle.opacity})`;
            sceneCtx.fill();
            return;
          }

          const grad = sceneCtx.createLinearGradient(
            tailX,
            tailY,
            particle.x,
            particle.y
          );
          grad.addColorStop(0, `hsl(${particle.hue} 100% 75% / 0)`);
          grad.addColorStop(1, `hsl(${particle.hue} 100% 78% / ${particle.opacity})`);
          sceneCtx.strokeStyle = grad;
          sceneCtx.lineWidth = particle.size * 1.4;
          sceneCtx.beginPath();
          sceneCtx.moveTo(tailX, tailY);
          sceneCtx.lineTo(particle.x, particle.y);
          sceneCtx.stroke();
        });
      });
    };

    const renderRing = (coordinateArray: RingPoint[]) => {
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      sceneCtx.beginPath();
      sceneCtx.moveTo(coordinateArray[0].x, coordinateArray[0].y);
      for (let i = 1; i < coordinateArray.length - 1; i++) {
        const xc = (coordinateArray[i].x + coordinateArray[i + 1].x) / 2;
        const yc = (coordinateArray[i].y + coordinateArray[i + 1].y) / 2;
        sceneCtx.quadraticCurveTo(
          coordinateArray[i].x,
          coordinateArray[i].y,
          xc,
          yc
        );
      }
      sceneCtx.quadraticCurveTo(
        coordinateArray[coordinateArray.length - 1].x,
        coordinateArray[coordinateArray.length - 1].y,
        coordinateArray[0].x,
        coordinateArray[0].y
      );
      sceneCtx.closePath();

      // Colour gets hotter (brighter + whiter core) the louder the bass
      const intensity = Math.min(1, smoothPunch * 2.2);
      const gradient = sceneCtx.createRadialGradient(
        centerX,
        centerY,
        radius * 0.2,
        centerX,
        centerY,
        radius * 1.6
      );
      gradient.addColorStop(0, `hsl(${hue} 100% ${70 + intensity * 25}%)`);
      gradient.addColorStop(0.6, `hsl(${hue + 35} 100% ${60 + intensity * 20}%)`);
      gradient.addColorStop(1, `hsl(${hue + 70} 95% 55%)`);

      sceneCtx.fillStyle = gradient;
      sceneCtx.fill();
    };

    const renderCore = () => {
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      // Kept deliberately smaller than the reactive ring so the ring stays the
      // hero; it still "breathes" with the track plus a kick on transients.
      const coreR =
        radius * 0.42 * currentLoudness * (1 + smoothPunch * 0.7) + radius * 0.04;
      if (coreR <= 0) return;

      sceneCtx.save();

      // Outer corona — large soft coloured halo
      const corona = sceneCtx.createRadialGradient(
        centerX,
        centerY,
        0,
        centerX,
        centerY,
        coreR * 2.6
      );
      corona.addColorStop(0, `hsl(${hue} 100% 70% / 0.5)`);
      corona.addColorStop(0.4, `hsl(${hue + 30} 100% 60% / 0.22)`);
      corona.addColorStop(1, `hsl(${hue + 60} 100% 50% / 0)`);
      sceneCtx.fillStyle = corona;
      sceneCtx.beginPath();
      sceneCtx.arc(centerX, centerY, coreR * 2.6, 0, 2 * Math.PI);
      sceneCtx.fill();

      // The orb itself — white-hot centre fading into the hue
      const orb = sceneCtx.createRadialGradient(
        centerX,
        centerY,
        0,
        centerX,
        centerY,
        coreR
      );
      orb.addColorStop(0, `hsl(${hue} 100% 96%)`);
      orb.addColorStop(0.45, `hsl(${hue} 100% 78%)`);
      orb.addColorStop(1, `hsl(${hue + 40} 100% 58%)`);
      sceneCtx.fillStyle = orb;
      sceneCtx.beginPath();
      sceneCtx.arc(centerX, centerY, coreR, 0, 2 * Math.PI);
      sceneCtx.fill();

      // A cluster of orbiting rings, like electron shells around a nucleus.
      // Each sits at a different radius, tilts and spins at its own rate and
      // direction, and the whole set pulses outward on bass hits.
      const orbitCount = 5;
      sceneCtx.globalCompositeOperation = "lighter";
      for (let r = 0; r < orbitCount; r++) {
        const orbitR =
          coreR * (1.18 + r * 0.16) * (1 + smoothPunch * 0.15);
        // Tilt animates so each ring tips between edge-on and face-on
        const tilt = Math.sin(time * 0.0005 + r * 1.3);
        const radiusY = orbitR * (0.16 + Math.abs(tilt) * 0.62);
        const rotation =
          time * 0.0006 * (r % 2 === 0 ? 1 : -1) + r * 0.7;
        sceneCtx.lineWidth = 2;
        sceneCtx.strokeStyle = `hsl(${hue + 25 + r * 24} 100% 72% / ${
          0.45 - r * 0.05
        })`;
        sceneCtx.beginPath();
        sceneCtx.ellipse(
          centerX,
          centerY,
          orbitR,
          radiusY,
          rotation,
          0,
          2 * Math.PI
        );
        sceneCtx.stroke();
      }

      sceneCtx.restore();
    };

    const renderShockwaves = () => {
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      sceneCtx.save();
      sceneCtx.globalCompositeOperation = "lighter";
      for (let i = shockwaves.length - 1; i >= 0; i--) {
        const wave = shockwaves[i];
        wave.radius += radius * 0.04 + wave.radius * 0.02;
        wave.opacity -= 0.012;
        if (wave.opacity <= 0) {
          shockwaves.splice(i, 1);
          continue;
        }
        sceneCtx.beginPath();
        sceneCtx.arc(centerX, centerY, wave.radius, 0, 2 * Math.PI);
        sceneCtx.lineWidth = wave.width;
        sceneCtx.strokeStyle = `hsl(${wave.hue} 100% 70% / ${wave.opacity})`;
        sceneCtx.stroke();
      }
      sceneCtx.restore();
    };

    const updateCoordinates = () => {
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      if (analyserRef.current) {
        analyserRef.current.getFloatFrequencyData(frequencyArray);
      }

      // Loop through and calculate the left half of the ring coordinates - the right half will mirror the left
      for (let i = 0; i <= totalRingPoints / 2; i++) {
        // Get the decibel value from the frequency array, skip the first couple of bins (around 10 hz) because nothing generally happens here
        // We need the negative reciprocal because getFloatFrequencyData() provides the decibels relative to full scale (dBFS), and they range from -Infinity to 0
        const audioValue = -1 / frequencyArray[i + binsToSkip];

        ringCoordinates[i].distanceFactor = Math.max(
          1 * currentLoudness,
          0.4 * (1 + 80 * audioValue)
        );
        ringCoordinates[i].x =
          centerX +
          radius *
            Math.cos((-ringCoordinates[i].angle * Math.PI) / 180) *
            ringCoordinates[i].distanceFactor;
        ringCoordinates[i].y =
          centerY +
          radius *
            Math.sin((-ringCoordinates[i].angle * Math.PI) / 180) *
            ringCoordinates[i].distanceFactor;

        if (i > 0) {
          ringCoordinates[totalRingPoints - i].x =
            2 * centerX - ringCoordinates[i].x;
          ringCoordinates[totalRingPoints - i].y = ringCoordinates[i].y;
        }
      }

      // The "loudness" will be the average distanceFactor value of the ring coordinates
      currentLoudness =
        ringCoordinates
          .map((x) => x.distanceFactor)
          .reduce((a, b) => a + b, 0) / ringCoordinates.length;

      // --- Derived visual signals (do not affect the extraction above) ---
      // Slow floor we compare against, then the transient above that floor.
      smoothLoudness += (currentLoudness - smoothLoudness) * 0.04;
      bassPunch = Math.max(0, currentLoudness - smoothLoudness);
      smoothPunch += (bassPunch - smoothPunch) * 0.12;

      // Aberration envelope: snap up instantly on a hit, then decay. Unlike the
      // eased smoothPunch this preserves the sharp transient, so the RGB split
      // punches on every bass hit and trails off like a glitch. High gain +
      // slow decay keep it obvious even on moderate bass.
      aberration = Math.max(aberration * 0.87, bassPunch * 45);

      // Hue drifts slowly and smoothly over time, deliberately independent of
      // the bass level so the colour never jumps or flickers on hits. The bass
      // is expressed through brightness, size, aberration and shockwaves.
      hue = (265 + time * 0.004) % 360;

      // Emit a shockwave on a strong, distinct bass hit (with a cooldown so a
      // single sustained kick doesn't spam rings)
      if (bassPunch > 0.1 && time - lastShockTime > 110) {
        lastShockTime = time;
        shockwaves.push({
          radius: radius * 0.6,
          opacity: Math.min(1, 0.5 + bassPunch),
          hue: hue + 20,
          width: 2 + bassPunch * 6,
        });
      }

      updateParticleCoordinates(centerX, centerY, radius);
    };

    const updateParticleCoordinates = (
      centerX: number,
      centerY: number,
      radius: number
    ) => {
      // Loop through and calculate the left half of the particle coordinates - the right half will mirror the left
      for (let i = 0; i < particleCoordinates.length / 2; i++) {
        const x =
          centerX +
          Math.cos((-particleCoordinates[i].angle * Math.PI) / 180) * radius;
        const y =
          centerY +
          Math.sin((-particleCoordinates[i].angle * Math.PI) / 180) * radius;
        const size = (Math.pow(Math.random(), 2) * 3 * radius) / 300;
        const opacity = Math.pow(Math.random(), 2);
        const particleHue = hue + 20 + Math.random() * 50;

        // As the loudness increases, the chance of a particle being generated should increase
        if (Math.pow(4 * currentLoudness - 3, 5) > Math.random() * 120) {
          particleCoordinates[i].particleCoordinateArray.push({
            x,
            y,
            size,
            opacity,
            angle: particleCoordinates[i].angle,
            speed: 0,
            hue: particleHue,
          });

          // Mirror to the right half
          particleCoordinates[
            particleCoordinates.length - i - 1
          ].particleCoordinateArray.push({
            x: 2 * centerX - x,
            y,
            size,
            opacity,
            angle: particleCoordinates[i].angle,
            speed: 0,
            hue: particleHue,
          });
        }

        for (
          let j = 0;
          j < particleCoordinates[i].particleCoordinateArray.length;
          j++
        ) {
          const angleChange = Math.random() < 0.5 ? -5 : 5;
          particleCoordinates[i].particleCoordinateArray[j].angle =
            particleCoordinates[i].particleCoordinateArray[j].angle +
              angleChange <
              particleCoordinates[i].angle - 60 ||
            particleCoordinates[i].particleCoordinateArray[j].angle +
              angleChange >
              particleCoordinates[i].angle + 60
              ? particleCoordinates[i].particleCoordinateArray[j].angle
              : particleCoordinates[i].particleCoordinateArray[j].angle +
                angleChange;
          particleCoordinates[i].particleCoordinateArray[j].speed =
            Math.pow(4 * currentLoudness - 3, 4) + 0.1;
          particleCoordinates[i].particleCoordinateArray[j].opacity -=
            0.001 * particleCoordinates[i].particleCoordinateArray[j].speed;
          particleCoordinates[i].particleCoordinateArray[j].x +=
            Math.cos(
              (-particleCoordinates[i].particleCoordinateArray[j].angle *
                Math.PI) /
                180
            ) * particleCoordinates[i].particleCoordinateArray[j].speed;
          particleCoordinates[i].particleCoordinateArray[j].y +=
            Math.sin(
              (-particleCoordinates[i].particleCoordinateArray[j].angle *
                Math.PI) /
                180
            ) * particleCoordinates[i].particleCoordinateArray[j].speed;

          // Drop particles that have left the screen or fully faded
          if (
            particleCoordinates[i].particleCoordinateArray[j].x >=
              canvas.width ||
            particleCoordinates[i].particleCoordinateArray[j].x <= 0 ||
            particleCoordinates[i].particleCoordinateArray[j].y >=
              canvas.height ||
            particleCoordinates[i].particleCoordinateArray[j].y <= 0 ||
            particleCoordinates[i].particleCoordinateArray[j].opacity <= 0
          ) {
            particleCoordinates[i].particleCoordinateArray.splice(j, 1);
            particleCoordinates[
              particleCoordinates.length - 1 - i
            ].particleCoordinateArray.splice(j, 1);
            continue;
          }

          // Mirror position, opacity and velocity to the right half (velocity
          // angle reflected across the vertical axis so the streak points right)
          particleCoordinates[
            particleCoordinates.length - 1 - i
          ].particleCoordinateArray[j].x =
            2 * centerX - particleCoordinates[i].particleCoordinateArray[j].x;
          particleCoordinates[
            particleCoordinates.length - 1 - i
          ].particleCoordinateArray[j].y =
            particleCoordinates[i].particleCoordinateArray[j].y;
          particleCoordinates[
            particleCoordinates.length - 1 - i
          ].particleCoordinateArray[j].opacity =
            particleCoordinates[i].particleCoordinateArray[j].opacity;
          particleCoordinates[
            particleCoordinates.length - 1 - i
          ].particleCoordinateArray[j].speed =
            particleCoordinates[i].particleCoordinateArray[j].speed;
          particleCoordinates[
            particleCoordinates.length - 1 - i
          ].particleCoordinateArray[j].angle =
            180 - particleCoordinates[i].particleCoordinateArray[j].angle;
        }
      }
    };

    // Isolate one colour channel of the assembled frame, then blit it into the
    // aberration buffer at an offset. Repeated per channel (additively) this
    // splits the whole image into RGB fringes — chromatic aberration. Offsets
    // are in chunky-pixel units.
    const splitChannel = (colour: string, dx: number, dy: number) => {
      const w = frameCanvas.width;
      const h = frameCanvas.height;
      chScratchCtx.globalCompositeOperation = "source-over";
      chScratchCtx.clearRect(0, 0, w, h);
      chScratchCtx.drawImage(frameCanvas, 0, 0);
      // Keep only this channel by multiplying by a pure colour...
      chScratchCtx.globalCompositeOperation = "multiply";
      chScratchCtx.fillStyle = colour;
      chScratchCtx.fillRect(0, 0, w, h);
      // ...then restore the original alpha mask (multiply made it opaque)
      chScratchCtx.globalCompositeOperation = "destination-in";
      chScratchCtx.drawImage(frameCanvas, 0, 0);
      abCtx.drawImage(chScratchCanvas, dx, dy);
    };

    // Thin dark lines aligned to the pixel grid, so the chunky pixels read as
    // the gaps between LEDs on an arcade display.
    const renderScanlines = () => {
      if (!ctx) return;
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "hsl(0 0% 0% / 0.22)";
      const lineH = Math.max(1, Math.round(pixelSize / 5));
      for (let y = pixelSize - lineH; y < canvas.height; y += pixelSize) {
        ctx.fillRect(0, y, canvas.width, lineH);
      }
    };

    const draw = (timestamp: number) => {
      // Break animation when context is disposed
      if (!ctx) return;

      requestAnimationFrame(draw);
      time = timestamp || 0;

      if (
        canvas.width !== canvas.clientWidth ||
        canvas.height !== canvas.clientHeight
      ) {
        resize();
      }

      updateCoordinates();

      // Render the full-colour scene onto the offscreen buffer
      sceneCtx.clearRect(0, 0, canvas.width, canvas.height);
      renderStars();
      renderShockwaves();
      renderParticles();
      renderRing(ringCoordinates);
      renderCore();

      // --- Composite into the low-res pixel buffers ---
      const pw = pixelCanvas.width;
      const ph = pixelCanvas.height;

      // 1) Assemble the frame (sharp scene + bloom) at pixel resolution.
      glowCtx.globalCompositeOperation = "source-over";
      glowCtx.clearRect(0, 0, glowCanvas.width, glowCanvas.height);
      glowCtx.drawImage(sceneCanvas, 0, 0, glowCanvas.width, glowCanvas.height);

      frameCtx.imageSmoothingEnabled = true;
      frameCtx.globalCompositeOperation = "source-over";
      frameCtx.globalAlpha = 1;
      frameCtx.clearRect(0, 0, pw, ph);
      frameCtx.drawImage(sceneCanvas, 0, 0, pw, ph); // sharp, downsampled
      frameCtx.globalCompositeOperation = "lighter";
      frameCtx.globalAlpha = 0.55;
      frameCtx.drawImage(
        glowCanvas,
        0,
        0,
        glowCanvas.width,
        glowCanvas.height,
        0,
        0,
        pw,
        ph
      ); // bloom
      frameCtx.globalAlpha = 1;
      frameCtx.globalCompositeOperation = "source-over";

      // 2) Chromatic aberration: split the WHOLE frame into RGB channels and
      // recombine them offset. Separation is driven by the bass-hit envelope;
      // when it's negligible we just copy the frame across.
      abCtx.globalAlpha = 1;
      abCtx.clearRect(0, 0, pw, ph);
      const sep = Math.min(8, aberration); // separation in chunky pixels
      if (sep < 0.4) {
        abCtx.globalCompositeOperation = "source-over";
        abCtx.drawImage(frameCanvas, 0, 0);
      } else {
        abCtx.globalCompositeOperation = "lighter";
        splitChannel("#ff0000", -sep, 0);
        splitChannel("#00ff00", 0, 0);
        splitChannel("#0000ff", sep, sep * 0.4);
        abCtx.globalCompositeOperation = "source-over";
      }

      // 3) Motion-trail fade (in pixel space, so trails stay chunky too), then
      // lay the aberrated frame over it. source-over avoids additive blowout.
      pixelCtx.imageSmoothingEnabled = true;
      pixelCtx.globalCompositeOperation = "source-over";
      pixelCtx.globalAlpha = 1;
      pixelCtx.fillStyle = "hsl(0 0% 0% / 0.35)";
      pixelCtx.fillRect(0, 0, pw, ph);
      pixelCtx.drawImage(abCanvas, 0, 0);

      // --- Upscale to the screen with NO smoothing → chunky arcade pixels ---
      ctx.imageSmoothingEnabled = false;
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(pixelCanvas, 0, 0, pw, ph, 0, 0, canvas.width, canvas.height);

      renderScanlines();
    };

    requestAnimationFrame(draw);

    return () => {
      // Dispose context to break animation so it doesn't continue running
      ctx = null;
    };
  }, []);

  const handlePlay = () => {
    if (audioContextRef.current?.state === "suspended") {
      audioContextRef.current.resume();
    }
  };

  return (
    <>
      <canvas
        ref={canvasRef}
        width={window.innerWidth}
        height={window.innerHeight}
      ></canvas>
      <div className={styles.audioWrapper}>
        <Uploader audioRef={audioRef} />
        <audio ref={audioRef} src={audio} controls onPlay={handlePlay}></audio>
      </div>
    </>
  );
}
