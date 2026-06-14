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
// Resting dB level the spectrum eases toward while paused, so the visual winds
// down to idle instead of freezing on whatever frame playback stopped.
const idleDb = -100;
const frequencyArray = new Float32Array(
  totalRingPoints / 2 + binsToSkip + 1
).fill(idleDb);

// Number of points around the liquid core's outline.
const liquidPoints = 96;

// A blob of molten liquid flung off the core on a bass hit. It springs back to
// the core's surface (damped) and shrinks, so it arcs out and is reabsorbed.
type Droplet = {
  angle: number; // direction from centre
  r: number; // current distance from centre
  vr: number; // radial velocity
  vAngle: number; // slow tangential drift
  size: number; // current radius
};

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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Full-resolution buffer holding the freshly drawn, sharp colour frame.
    const sceneCanvas = document.createElement("canvas");
    const sceneCtx = sceneCanvas.getContext("2d")!;

    // Tiny buffer holding a heavily downscaled copy of the scene, blitted back
    // upscaled to produce a cheap blur/bloom. The downscale factor is set per
    // resize by applyQualityForWidth (narrow screens blur at lower resolution).
    let glowScale = 0.25;
    const glowCanvas = document.createElement("canvas");
    const glowCtx = glowCanvas.getContext("2d")!;

    // Full-resolution post-processing buffers. The sharp scene is copied into
    // `frameCanvas`, split into RGB channels (via `chScratchCanvas`) and
    // recombined with an offset into `abCanvas` for the chromatic aberration.
    // The aberrated frame is laid over the persistent `trailCanvas` (the
    // motion-trail history), which is blitted to the screen with a bass-driven
    // zoom punch and a fresh bloom on top.
    const frameCanvas = document.createElement("canvas");
    const chScratchCanvas = document.createElement("canvas");
    const abCanvas = document.createElement("canvas");
    const trailCanvas = document.createElement("canvas");
    const frameCtx = frameCanvas.getContext("2d")!;
    const chScratchCtx = chScratchCanvas.getContext("2d")!;
    const abCtx = abCanvas.getContext("2d")!;
    const trailCtx = trailCanvas.getContext("2d")!;

    const ringCoordinates: RingPoint[] = [];
    const particleCoordinates: ParticleCoordinates[] = [];
    const shockwaves: Shockwave[] = [];
    const droplets: Droplet[] = [];
    let stars: Star[] = [];

    let radius = Math.min(canvas.width, canvas.height) / 4;
    let currentLoudness = 0;
    // Mean radius of the liquid core this frame, shared so droplets spawn at and
    // spring back to its surface.
    let liquidR = 0;
    // The blob's smooth-body radius factor = the minimum ring distanceFactor
    // (the floor the non-spike points sit at). The centre disc sits just inside
    // this so the white blob shows as a constant-thickness border ring.
    let bodyFactor = 0;

    // Smoothed/derived signals used purely for the visuals (they never feed
    // back into the bass extraction maths below).
    let smoothLoudness = 0; // slow average, the "floor" we measure hits against
    let bassPunch = 0; // how far above the floor we currently are (the transient)
    let smoothPunch = 0; // eased punch, so colour/brightness don't strobe
    let aberration = 0; // fast-attack/slow-decay envelope driving the RGB split
    let aberrationBase = 0; // sustained split level while the track is hitting
    let flash = 0; // supernova white-bloom envelope, fires on the biggest hits
    let godray = 0; // volumetric light-shaft intensity envelope
    let rayAngle = 0; // god-ray rotation, advanced while a burst is visible
    let punchZoom = 0; // screen zoom-push envelope on each kick
    let hue = 265; // base hue, slowly drifts over time
    let time = 0;
    let lastShockTime = -1000;
    let lastFlashTime = -1000;
    let lastDropletTime = -1000;

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

    // Visual quality tapers with viewport width (recomputed per resize) to keep
    // mobile cheap: fewer particle slots — each is an angular emitter that can
    // spawn a comet per loud frame — and a smaller bloom buffer, the heaviest
    // pass yet barely noticeable on a small screen.
    const REF_FULL_WIDTH = 1100; // at/above this width: full quality
    const REF_MIN_WIDTH = 380; // at/below this width: lowest quality
    const SLOTS_FULL = 360;
    const SLOTS_MIN = 110;
    const GLOW_SCALE_FULL = 0.25;
    const GLOW_SCALE_MIN = 0.12;
    let particleSlotCount = 0;

    const applyQualityForWidth = (width: number) => {
      const t = Math.max(
        0,
        Math.min(
          1,
          (width - REF_MIN_WIDTH) / (REF_FULL_WIDTH - REF_MIN_WIDTH)
        )
      );
      glowScale = GLOW_SCALE_MIN + t * (GLOW_SCALE_FULL - GLOW_SCALE_MIN);

      const slotCount = Math.round(SLOTS_MIN + t * (SLOTS_FULL - SLOTS_MIN));
      // Only rebuild slots when the count changes — resize fires continuously
      // while dragging, and a rebuild drops in-flight particles.
      if (slotCount !== particleSlotCount) {
        particleSlotCount = slotCount;
        const angleStep = 360 / slotCount;
        particleCoordinates.length = 0;
        for (let angle = 90; angle < 450; angle += angleStep) {
          particleCoordinates.push({ particleCoordinateArray: [], angle });
        }
      }
    };

    for (let angle = 90; angle < 450; angle += 360 / totalRingPoints) {
      ringCoordinates.push({
        angle,
        x: (canvas.width / 2) * Math.cos((-angle * Math.PI) / 180),
        y: (canvas.height / 2) * Math.sin((-angle * Math.PI) / 180),
        distanceFactor: 1,
      });
    }

    const resize = () => {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      // Must run before the glow buffer is sized below, which reads glowScale.
      applyQualityForWidth(canvas.width);
      sceneCanvas.width = frameCanvas.width = chScratchCanvas.width =
        abCanvas.width = trailCanvas.width = canvas.width;
      sceneCanvas.height = frameCanvas.height = chScratchCanvas.height =
        abCanvas.height = trailCanvas.height = canvas.height;
      glowCanvas.width = Math.max(1, Math.round(canvas.width * glowScale));
      glowCanvas.height = Math.max(1, Math.round(canvas.height * glowScale));
      radius = Math.min(canvas.width, canvas.height) / 4;
      seedStars();
    };
    resize();
    window.addEventListener("resize", resize);

    const renderStars = () => {
      // Every star shares the same colour within a frame (only its alpha
      // flickers), so set the fillStyle once and drive the per-star flicker
      // through globalAlpha — avoids building an hsl() string per star/frame.
      sceneCtx.fillStyle = `hsl(${hue + 30} 40% 90%)`;
      for (const star of stars) {
        sceneCtx.globalAlpha =
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
        sceneCtx.fill();
      }
      sceneCtx.globalAlpha = 1;
    };

    // Comet sprite atlas: one pre-rendered streak texture per hue bucket, so the
    // hundreds of particles on a bass hit just translate/rotate/scale/drawImage a
    // sprite instead of each rebuilding a gradient every frame. Each sprite is a
    // round-capped line with a tail(transparent)→head(opaque) gradient;
    // per-particle opacity is applied via globalAlpha at draw time.
    const cometBuckets = 36; // 360 / 36 = 10° hue resolution
    const cometSpriteLen = 64; // sprite length in px (mapped to streak length)
    const cometCoreW = 12; // sprite line thickness (mapped to streak width)
    const cometSpriteH = cometCoreW;
    const cometSprites: HTMLCanvasElement[] = [];
    for (let b = 0; b < cometBuckets; b++) {
      const h = (b * 360) / cometBuckets;
      const sprite = document.createElement("canvas");
      sprite.width = cometSpriteLen;
      sprite.height = cometSpriteH;
      const sctx = sprite.getContext("2d")!;
      const grad = sctx.createLinearGradient(0, 0, cometSpriteLen, 0);
      // Near-white with only a faint hue tint, so the chromatic aberration
      // fringes read hard against the streaks the same way they do on the core.
      grad.addColorStop(0, `hsl(${h} 25% 92% / 0)`);
      grad.addColorStop(1, `hsl(${h} 25% 92% / 1)`);
      sctx.strokeStyle = grad;
      sctx.lineWidth = cometCoreW;
      sctx.lineCap = "round";
      sctx.beginPath();
      sctx.moveTo(cometCoreW / 2, cometSpriteH / 2);
      sctx.lineTo(cometSpriteLen - cometCoreW / 2, cometSpriteH / 2);
      sctx.stroke();
      cometSprites.push(sprite);
    }

    // Draw the flying particles as comet streaks whose length follows the
    // particle's velocity (so they stretch out as the bass speeds them up).
    // Their soft glow comes from the bloom pass rather than a per-particle
    // shadowBlur.
    const trailFrames = 6; // how many frames of motion the tail spans
    const renderParticles = () => {
      particleCoordinates.forEach((position) => {
        position.particleCoordinateArray.forEach((particle) => {
          const vx =
            Math.cos((-particle.angle * Math.PI) / 180) * particle.speed;
          const vy =
            Math.sin((-particle.angle * Math.PI) / 180) * particle.speed;
          const streakLen = Math.hypot(vx, vy) * trailFrames;

          // Too slow to streak meaningfully → just a dot
          if (streakLen < particle.size) {
            sceneCtx.beginPath();
            sceneCtx.arc(particle.x, particle.y, particle.size, 0, 2 * Math.PI);
            sceneCtx.fillStyle = `hsl(${particle.hue} 25% 92% / ${particle.opacity})`;
            sceneCtx.fill();
            return;
          }

          const tailX = particle.x - vx * trailFrames;
          const tailY = particle.y - vy * trailFrames;
          const bucket =
            ((Math.round((particle.hue / 360) * cometBuckets) % cometBuckets) +
              cometBuckets) %
            cometBuckets;

          // Place the sprite from tail (local origin) to head: rotate to the
          // velocity direction, scale x to the streak length and y to its
          // width. The baked gradient (0→1 alpha) times globalAlpha reproduces
          // the old transparent-tail → opacity-head fade.
          sceneCtx.save();
          sceneCtx.globalAlpha = Math.max(0, Math.min(1, particle.opacity));
          sceneCtx.translate(tailX, tailY);
          sceneCtx.rotate(Math.atan2(vy, vx));
          sceneCtx.scale(
            streakLen / cometSpriteLen,
            (particle.size * 1.4) / cometCoreW
          );
          sceneCtx.drawImage(cometSprites[bucket], 0, -cometSpriteH / 2);
          sceneCtx.restore();
        });
      });
    };

    const renderRing = (coordinateArray: RingPoint[]) => {
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

      // Trap-Nation silhouette, the right way round: the reactive blob is filled
      // SOLID WHITE. A central black disc (renderCenterDisc) then masks its body,
      // leaving a constant-thickness white ring (the "border") around the disc;
      // the bass-driven spikes are the same white blob protruding past that ring,
      // so they blend straight in. The chromatic aberration bites the white edges.
      sceneCtx.fillStyle = "hsl(0 0% 100%)";
      sceneCtx.fill();
    };

    // A plain black disc drawn in front of the white blob, sitting just INSIDE
    // the blob's smooth body (bodyFactor = the distanceFactor floor). The white
    // blob therefore shows as a constant-thickness ring around the disc — that
    // ring IS the border (no separate stroke needed), and the bass spikes are
    // the same white blob protruding further out, so they blend straight into
    // it. At rest only the bordered circle shows; on a hit the spikes erupt.
    const borderWidth = 0.07; // ring thickness as a fraction of `radius`
    const renderCenterDisc = () => {
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const discR = radius * bodyFactor - radius * borderWidth;
      if (discR <= 0) return;
      sceneCtx.globalCompositeOperation = "source-over";
      sceneCtx.fillStyle = "hsl(0 0% 0%)";
      sceneCtx.beginPath();
      sceneCtx.arc(centerX, centerY, discR, 0, 2 * Math.PI);
      sceneCtx.fill();
    };

    const renderCore = () => {
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      sceneCtx.save();

      // --- Liquid molten core ---------------------------------------------
      // A single glowing blob of white-hot liquid. Its outline is a full-circle
      // organic shape built from integer sine harmonics (so it is inherently
      // seamless — no mirror cusp), whose phases drift over time, so it morphs
      // and slowly churns like liquid. The wobble amplitude grows with the bass
      // so it agitates harder on hits, and the whole thing swells on transients.
      // Deliberately NOT left/right mirrored: free asymmetry reads far more
      // "alive" than a symmetric lump. White-on-dark is exactly what the
      // chromatic aberration wants, so its edge fringes hard.
      const baseR = radius * 0.26 * (1 + smoothPunch * 0.5) + radius * 0.05;
      liquidR = baseR;
      const a1 = 0.12 * (1 + smoothPunch * 1.2);
      const a2 = 0.08 * (1 + smoothPunch * 1.5);
      const a3 = 0.05 * (1 + smoothPunch * 2);

      const px: number[] = [];
      const py: number[] = [];
      for (let i = 0; i < liquidPoints; i++) {
        const th = (i / liquidPoints) * Math.PI * 2;
        const rr =
          baseR *
          (1 +
            a1 * Math.sin(2 * th + time * 0.0006) +
            a2 * Math.sin(3 * th - time * 0.0009) +
            a3 * Math.sin(5 * th + time * 0.0013));
        px.push(centerX + Math.cos(th) * rr);
        py.push(centerY + Math.sin(th) * rr);
      }

      // Smooth the closed loop with quadratic curves through the point
      // midpoints (starting on the midpoint of the seam so it joins cleanly).
      const n = px.length;
      sceneCtx.beginPath();
      sceneCtx.moveTo((px[n - 1] + px[0]) / 2, (py[n - 1] + py[0]) / 2);
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        sceneCtx.quadraticCurveTo(
          px[i],
          py[i],
          (px[i] + px[j]) / 2,
          (py[i] + py[j]) / 2
        );
      }
      sceneCtx.closePath();

      const molten = sceneCtx.createRadialGradient(
        centerX,
        centerY,
        0,
        centerX,
        centerY,
        baseR * 1.25
      );
      molten.addColorStop(0, `hsl(0 0% 100%)`);
      molten.addColorStop(0.55, `hsl(0 0% 95%)`);
      molten.addColorStop(1, `hsl(0 0% 80% / 0.85)`);
      sceneCtx.globalCompositeOperation = "lighter";
      sceneCtx.fillStyle = molten;
      sceneCtx.fill();

      // --- Droplets -------------------------------------------------------
      // Update + draw the flung droplets. They spring back to the core surface
      // (damped) and shrink, so each arcs out and is reabsorbed.
      for (let i = droplets.length - 1; i >= 0; i--) {
        const drop = droplets[i];
        drop.vr += (baseR - drop.r) * 0.025; // spring to the surface
        drop.vr *= 0.94; // damping
        drop.r += drop.vr;
        drop.angle += drop.vAngle;
        drop.size *= 0.975; // slowly shrink → reabsorbed
        if (drop.size < radius * 0.004) {
          droplets.splice(i, 1);
          continue;
        }
        const dx = centerX + Math.cos(drop.angle) * drop.r;
        const dy = centerY + Math.sin(drop.angle) * drop.r;
        const dg = sceneCtx.createRadialGradient(dx, dy, 0, dx, dy, drop.size * 2);
        dg.addColorStop(0, `hsl(0 0% 100% / 0.95)`);
        dg.addColorStop(1, `hsl(0 0% 90% / 0)`);
        sceneCtx.fillStyle = dg;
        sceneCtx.beginPath();
        sceneCtx.arc(dx, dy, drop.size * 2, 0, 2 * Math.PI);
        sceneCtx.fill();
      }

      // Supernova flash — a fast white bloom over the core on big hits, so heavy
      // drops read as genuinely bigger than ordinary kicks.
      if (flash > 0.01) {
        const fr = baseR * (2 + flash * 3);
        const fg = sceneCtx.createRadialGradient(
          centerX,
          centerY,
          0,
          centerX,
          centerY,
          fr
        );
        fg.addColorStop(0, `hsl(0 0% 100% / ${0.9 * flash})`);
        fg.addColorStop(0.5, `hsl(0 0% 95% / ${0.4 * flash})`);
        fg.addColorStop(1, `hsl(0 0% 80% / 0)`);
        sceneCtx.fillStyle = fg;
        sceneCtx.beginPath();
        sceneCtx.arc(centerX, centerY, fr, 0, 2 * Math.PI);
        sceneCtx.fill();
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

    // Volumetric light shafts radiating from the core on bass hits: a handful of
    // long, thin additive gradient blades that fan out and spin, their brightness
    // driven by the `godray` envelope so they bloom in on a kick and fade out.
    const rayCount = 12;
    const renderGodRays = () => {
      if (godray < 0.02) return;
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const len = Math.max(canvas.width, canvas.height);
      sceneCtx.save();
      sceneCtx.globalCompositeOperation = "lighter";
      sceneCtx.translate(centerX, centerY);
      sceneCtx.rotate(rayAngle);
      for (let i = 0; i < rayCount; i++) {
        // Stagger length/intensity so the fan isn't perfectly uniform.
        const wobble = 0.6 + 0.4 * Math.sin(i * 2.3 + time * 0.001);
        sceneCtx.save();
        sceneCtx.rotate((i / rayCount) * Math.PI * 2);
        const grad = sceneCtx.createLinearGradient(0, 0, len, 0);
        grad.addColorStop(
          0,
          `hsl(${hue + 40} 100% 85% / ${0.45 * godray * wobble})`
        );
        grad.addColorStop(1, `hsl(${hue + 40} 100% 70% / 0)`);
        sceneCtx.fillStyle = grad;
        const halfW = radius * 0.05 * wobble;
        sceneCtx.beginPath();
        sceneCtx.moveTo(0, -halfW);
        sceneCtx.lineTo(len, -halfW * 0.15);
        sceneCtx.lineTo(len, halfW * 0.15);
        sceneCtx.lineTo(0, halfW);
        sceneCtx.closePath();
        sceneCtx.fill();
        sceneCtx.restore();
      }
      sceneCtx.restore();
    };

    const updateCoordinates = () => {
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      // While playing, read the live spectrum. While paused, the analyser output
      // is frozen (the context is suspended), so instead ease the spectrum
      // toward silence — the blob relaxes to its idle ring and the particles
      // slow and stop, rather than locking on the frame playback stopped.
      if (analyserRef.current && !audioRef.current?.paused) {
        analyserRef.current.getFloatFrequencyData(frequencyArray);
      } else {
        for (let k = 0; k < frequencyArray.length; k++) {
          frequencyArray[k] += (idleDb - frequencyArray[k]) * 0.06;
        }
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

      // The "loudness" will be the average distanceFactor value of the ring
      // coordinates (plain loop to avoid allocating an array every frame). We
      // also track the minimum, which is the blob's smooth-body radius factor
      // (the floor the non-spike points sit at) used to size the centre disc.
      // The minimum is taken over only the COMPUTED half (0..totalRingPoints/2):
      // the right-half points only have their x/y mirrored, so their
      // distanceFactor is stale (stuck at the initial 1) and would wrongly pin
      // the body factor at 1 once the real floor climbs above 1 on loud parts.
      let loudnessSum = 0;
      let minFactor = Infinity;
      for (let k = 0; k < ringCoordinates.length; k++) {
        const f = ringCoordinates[k].distanceFactor;
        loudnessSum += f;
        if (k <= totalRingPoints / 2 && f < minFactor) minFactor = f;
      }
      currentLoudness = loudnessSum / ringCoordinates.length;
      bodyFactor = minFactor;

      // --- Derived visual signals (do not affect the extraction above) ---
      // Slow floor we compare against, then the transient above that floor.
      smoothLoudness += (currentLoudness - smoothLoudness) * 0.04;
      bassPunch = Math.max(0, currentLoudness - smoothLoudness);
      smoothPunch += (bassPunch - smoothPunch) * 0.12;

      // Aberration envelope: snap up instantly on a hit, then decay. Unlike the
      // eased smoothPunch this preserves the sharp transient, so the RGB split
      // punches on every bass hit and trails off like a glitch. The gain is high
      // because the split now runs at full resolution and lands against the
      // white core/particles, where we want it to really bite. Decay is a touch
      // slow so each hit's split lingers long enough to actually be seen.
      aberration = Math.max(aberration * 0.9, bassPunch * 150);

      // Sustained baseline that builds up while the track is actively hitting
      // and decays away during quiet/idle. This is what keeps the split visibly
      // present the WHOLE time music plays, instead of only for the instant
      // after a big hit. Fast attack, slow release so it holds between beats; at
      // idle there are no hits, so it settles to ~0 and start-up is unchanged.
      const aberrationTarget = Math.min(1, bassPunch * 8);
      aberrationBase +=
        (aberrationTarget - aberrationBase) *
        (aberrationTarget > aberrationBase ? 0.2 : 0.02);

      // Screen zoom-push: snaps out on a kick, eases back. Always >= 0 so the
      // final blit only ever scales up — no background gaps at the edges.
      punchZoom = Math.max(punchZoom * 0.86, bassPunch * 0.8);

      // God-ray intensity follows the same fast-attack/decay shape, clamped.
      godray = Math.max(godray * 0.9, Math.min(1, bassPunch * 5));
      // Spin the ray fan while it's actually visible: the rate is tied to the
      // envelope, so each burst whips around as it flares and decelerates as it
      // fades, instead of crawling at a constant speed. It just holds its angle
      // between bursts (when the rays are invisible anyway).
      rayAngle += godray * 0.07;

      // Supernova flash: only the biggest, spaced-out hits trigger it, then it
      // decays fast so heavy drops read as bigger than ordinary kicks.
      flash *= 0.88;
      if (bassPunch > 0.16 && time - lastFlashTime > 220) {
        lastFlashTime = time;
        flash = 1;
      }

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

      // Fling molten droplets off the core. This has its own, much lower
      // threshold and shorter cooldown than the shockwave above, so the surface
      // stays lively on ordinary kicks instead of only erupting on huge hits.
      // The count scales with how hard the hit is.
      if (bassPunch > 0.035 && time - lastDropletTime > 50) {
        lastDropletTime = time;
        const count = 3 + Math.floor(Math.min(11, bassPunch * 36));
        for (let d = 0; d < count && droplets.length < 160; d++) {
          droplets.push({
            angle: Math.random() * Math.PI * 2,
            r: liquidR,
            vr: radius * (0.02 + Math.random() * 0.045) * (0.8 + bassPunch * 4),
            vAngle: (Math.random() - 0.5) * 0.05,
            size: radius * (0.012 + Math.random() * 0.022),
          });
        }
      }

      updateParticleCoordinates(centerX, centerY, radius);
    };

    const updateParticleCoordinates = (
      centerX: number,
      centerY: number,
      radius: number
    ) => {
      // Only the left half is simulated; the right half mirrors it across the
      // vertical axis.
      for (let i = 0; i < particleCoordinates.length / 2; i++) {
        const baseAngle = particleCoordinates[i].angle;
        const leftArr = particleCoordinates[i].particleCoordinateArray;
        const mirrorArr =
          particleCoordinates[particleCoordinates.length - 1 - i]
            .particleCoordinateArray;

        const x = centerX + Math.cos((-baseAngle * Math.PI) / 180) * radius;
        const y = centerY + Math.sin((-baseAngle * Math.PI) / 180) * radius;
        const size = (Math.pow(Math.random(), 2) * 3 * radius) / 300;
        const opacity = Math.pow(Math.random(), 2);
        const particleHue = hue + 20 + Math.random() * 50;

        // The louder it gets, the more likely a new particle spawns this frame.
        if (Math.pow(4 * currentLoudness - 3, 5) > Math.random() * 120) {
          leftArr.push({
            x,
            y,
            size,
            opacity,
            angle: baseAngle,
            speed: 0,
            hue: particleHue,
          });
          mirrorArr.push({
            x: 2 * centerX - x,
            y,
            size,
            opacity,
            angle: baseAngle,
            speed: 0,
            hue: particleHue,
          });
        }

        for (let j = 0; j < leftArr.length; j++) {
          const p = leftArr[j];

          // Wander the heading by ±5°, but keep it within ±60° of the spawn angle.
          const newAngle = p.angle + (Math.random() < 0.5 ? -5 : 5);
          if (newAngle >= baseAngle - 60 && newAngle <= baseAngle + 60) {
            p.angle = newAngle;
          }

          p.speed = Math.pow(4 * currentLoudness - 3, 4) + 0.1;
          p.opacity -= 0.001 * p.speed;
          p.x += Math.cos((-p.angle * Math.PI) / 180) * p.speed;
          p.y += Math.sin((-p.angle * Math.PI) / 180) * p.speed;

          // Drop particles that have left the screen or fully faded.
          if (
            p.x >= canvas.width ||
            p.x <= 0 ||
            p.y >= canvas.height ||
            p.y <= 0 ||
            p.opacity <= 0
          ) {
            leftArr.splice(j, 1);
            mirrorArr.splice(j, 1);
            continue;
          }

          // Mirror position, opacity and velocity (heading reflected across the
          // vertical axis so the streak points the other way).
          const m = mirrorArr[j];
          m.x = 2 * centerX - p.x;
          m.y = p.y;
          m.opacity = p.opacity;
          m.speed = p.speed;
          m.angle = 180 - p.angle;
        }
      }
    };

    // Isolate one colour channel of the assembled frame, then blit it into the
    // aberration buffer at an offset. Repeated per channel (additively) this
    // splits the whole image into RGB fringes — chromatic aberration. Offsets
    // are in device pixels.
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
      renderGodRays();
      renderParticles();
      renderRing(ringCoordinates);
      renderCenterDisc();
      renderCore();

      // --- Full-resolution post-processing ---
      const w = canvas.width;
      const h = canvas.height;

      // 1) Build the glow source. The bloom itself is NOT mixed in here — it's
      // applied fresh at the very end (step 4) so it can't accumulate in the
      // motion-trail buffer, which is what made it flicker.
      glowCtx.imageSmoothingEnabled = true;
      glowCtx.imageSmoothingQuality = "high";
      glowCtx.globalCompositeOperation = "source-over";
      glowCtx.clearRect(0, 0, glowCanvas.width, glowCanvas.height);
      glowCtx.drawImage(sceneCanvas, 0, 0, glowCanvas.width, glowCanvas.height);

      // The frame fed to the aberration + trail is the SHARP scene only.
      frameCtx.imageSmoothingEnabled = true;
      frameCtx.imageSmoothingQuality = "high";
      frameCtx.globalCompositeOperation = "source-over";
      frameCtx.globalAlpha = 1;
      frameCtx.clearRect(0, 0, w, h);
      frameCtx.drawImage(sceneCanvas, 0, 0);

      // 2) Chromatic aberration: split the WHOLE frame into RGB channels and
      // recombine them offset. Separation is driven by the bass-hit envelope;
      // when it's negligible we just copy the frame across.
      abCtx.globalAlpha = 1;
      abCtx.clearRect(0, 0, w, h);
      // Total separation = sustained baseline (present throughout playback) +
      // the sharp per-hit spike on top, clamped so it never goes absurd.
      const sep = Math.min(
        radius * 0.16,
        aberrationBase * radius * 0.07 + aberration
      ); // separation in device px
      if (sep < 0.5) {
        abCtx.globalCompositeOperation = "source-over";
        abCtx.drawImage(frameCanvas, 0, 0);
      } else {
        abCtx.globalCompositeOperation = "lighter";
        splitChannel("#ff0000", -sep, 0);
        splitChannel("#00ff00", 0, 0);
        splitChannel("#0000ff", sep, sep * 0.4);
        abCtx.globalCompositeOperation = "source-over";
      }

      // 3) Motion-trail fade, then lay the aberrated frame over the history.
      // source-over avoids additive blowout.
      trailCtx.imageSmoothingEnabled = true;
      trailCtx.globalCompositeOperation = "source-over";
      trailCtx.globalAlpha = 1;
      trailCtx.fillStyle = "hsl(0 0% 0% / 0.35)";
      trailCtx.fillRect(0, 0, w, h);
      trailCtx.drawImage(abCanvas, 0, 0);

      // 4) Blit to the screen with a bass-driven zoom-push centred on the core.
      // The scale is always >= 1, so zooming in never exposes the canvas edges.
      const zoom = 1 + Math.min(0.04, punchZoom);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(-w / 2, -h / 2);
      ctx.drawImage(trailCanvas, 0, 0);
      // Bloom, applied FRESH here on top of the trail (not mixed into it), so it
      // reflects only the current frame and never accumulates. That accumulation
      // in the motion trail was what made the glow overshoot and flicker as the
      // blob's ring changed size with the music. Gaussian-blurred so the halo is
      // smooth rather than stair-stepped from the low-res upscale.
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.5;
      ctx.filter = `blur(${Math.max(2, Math.round(radius * 0.06))}px)`;
      ctx.drawImage(
        glowCanvas,
        0,
        0,
        glowCanvas.width,
        glowCanvas.height,
        0,
        0,
        w,
        h
      );
      ctx.filter = "none";
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.restore();
    };

    requestAnimationFrame(draw);

    return () => {
      // Dispose context to break animation so it doesn't continue running
      ctx = null;
      window.removeEventListener("resize", resize);
    };
  }, []);

  const handlePlay = () => {
    // The play button is the user gesture that lets the context start, and what
    // resumes it after a pause.
    if (audioContextRef.current?.state === "suspended") {
      audioContextRef.current.resume();
    }
  };

  const handlePause = () => {
    // Suspend the context on pause so its buffered tail can't keep getting
    // re-rendered by the destination — that drain is the looping-fragment glitch.
    audioContextRef.current?.suspend();
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
        <audio
          ref={audioRef}
          src={audio}
          controls
          onPlay={handlePlay}
          onPause={handlePause}
        ></audio>
      </div>
    </>
  );
}
