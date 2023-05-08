import React, { useEffect, useRef, useState } from "react";
import Uploader from "../Uploader/Uploader";
import "./App.css";

let audioSource = null;
function App() {
  const canvasRef = useRef(null);
  const audioRef = useRef(null);
  const logoRef = useRef(null);
  const totalRingPoints = 48;
  const [{ audioContext, analyser, frequencyArray }, setAudioData] = useState({
    audioContext: null,
    analyser: null,
    frequencyArray: new Float32Array(totalRingPoints),
  });

  // Set up audio context
  useEffect(() => {
    if (!audioSource) {
      // Create audio context
      const audioElement = audioRef.current;
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const newAudioContext = new AudioContext({ sampleRate: 44100 });
      audioSource = newAudioContext.createMediaElementSource(audioElement);

      // Create analyser
      const newAnalyser = newAudioContext.createAnalyser();
      newAnalyser.fftSize = 8192;
      audioSource.connect(newAnalyser);
      newAnalyser.connect(newAudioContext.destination);

      setAudioData((previousValue) => ({
        ...previousValue,
        audioContext: newAudioContext,
        analyser: newAnalyser,
      }));
    }
  }, []);

  // User interaction is needed before we can resume the audio context
  useEffect(() => {
    function resumeAudioContext() {
      audioContext?.state === "suspended" && audioContext.resume();
    }

    document.addEventListener("touchend", resumeAudioContext);
    document.addEventListener("click", resumeAudioContext);

    return () => {
      document.removeEventListener("touchend", resumeAudioContext);
      document.removeEventListener("click", resumeAudioContext);
    };
  }, [audioContext]);

  // Set up canvas visualiser
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const ringCoordinates = [];
    const particleCoordinates = [];

    let radius = Math.min(canvas.width, canvas.height) / 4;
    let currentLoudness = 0;

    // Set up the empty 2d particle array for the flying particles
    for (let angle = 90; angle < 450; angle += 1) {
      particleCoordinates.push({
        particleCoordinateArray: [],
        angle: angle,
      });
    }

    // Initialise ring points
    for (let angle = 90; angle < 450; angle += 360 / totalRingPoints) {
      const pointData = JSON.stringify({
        angle: angle,
        x: (canvas.width / 2) * Math.cos((-angle * Math.PI) / 180),
        y: (canvas.height / 2) * Math.sin((-angle * Math.PI) / 180),
        distanceFactor: 1,
      });

      ringCoordinates.push(JSON.parse(pointData));
    }

    // Draw the flying particles
    function renderParticles() {
      particleCoordinates.forEach((position) => {
        position.particleCoordinateArray.forEach((particle) => {
          ctx.beginPath();
          ctx.arc(particle.x, particle.y, particle.size, 0, 2 * Math.PI);
          ctx.closePath();
          ctx.fillStyle = `rgba(255, 255, 255, ${particle.opacity})`;
          ctx.fill();
        });
      });
    }

    // Render the ring based on coordinates provided
    function renderRing(coordinateArray, fillColour) {
      ctx.shadowBlur = radius / 12;
      ctx.shadowColor = fillColour;
      ctx.fillStyle = fillColour;
      ctx.beginPath();
      ctx.moveTo(coordinateArray[0].x, coordinateArray[0].y);
      for (let i = 1; i < coordinateArray.length - 1; i++) {
        var xc = (coordinateArray[i].x + coordinateArray[i + 1].x) / 2;
        var yc = (coordinateArray[i].y + coordinateArray[i + 1].y) / 2;
        ctx.quadraticCurveTo(
          coordinateArray[i].x,
          coordinateArray[i].y,
          xc,
          yc
        );
      }
      ctx.quadraticCurveTo(
        coordinateArray[coordinateArray.length - 1].x,
        coordinateArray[coordinateArray.length - 1].y,
        coordinateArray[0].x,
        coordinateArray[0].y
      );
      ctx.closePath();
      ctx.fill();
    }

    // Adjust logo size with loudness
    function adjustLogoSize() {
      logoRef.current.style.width = `${radius * 0.9 * currentLoudness * 2}px`;
      logoRef.current.style.height = `${radius * 0.9 * currentLoudness * 2}px`;
    }

    // Update the coordinates of the rings and particles
    function updateCoordinates() {
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      analyser && analyser.getFloatFrequencyData(frequencyArray);

      // Loop through and calculate the left half of the ring coordinates - the right half will mirror the left
      for (let i = 0; i <= totalRingPoints / 2; i++) {
        // Get the sample from the frequency array, skip the first few bins (15-20hz)
        const audioValue = -1 / frequencyArray[i + 2];

        ringCoordinates[i].distanceFactor = Math.max(
          1 * currentLoudness,
          0.65 * (1 + 30 * audioValue)
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

      updateParticleCoordinates(centerX, centerY, radius);
    }

    // Update the coordinates of the flying particles
    function updateParticleCoordinates(centerX, centerY, radius) {
      // Loop through and calculate the left half of the particle coordinates - the right half will mirror the left
      for (let i = 0; i < particleCoordinates.length / 2; i++) {
        //
        const x =
          centerX +
          Math.cos((-particleCoordinates[i].angle * Math.PI) / 180) * radius;
        const y =
          centerY +
          Math.sin((-particleCoordinates[i].angle * Math.PI) / 180) * radius;
        const size = Math.pow(Math.random(), 2) * 3;
        const opacity = Math.pow(Math.random(), 2);

        // As the loudness increases, the chance of a particle being generated should increase
        if (Math.pow(4 * currentLoudness - 3, 5) > Math.random() * 60) {
          particleCoordinates[i].particleCoordinateArray.push({
            x,
            y,
            size,
            opacity,
            angle: particleCoordinates[i].angle,
          });
          particleCoordinates[
            particleCoordinates.length - i - 1
          ].particleCoordinateArray.push({
            x: 2 * centerX - x,
            y,
            size,
            opacity,
          });
        }

        // Update the x and y coordinates for the particles
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
            Math.pow(4 * currentLoudness - 3, 6) + 0.1;
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

          // If the particle has left the screen, remove it from the array as we no longer need to track it
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

          // Update mirrored particle coordinates (right half)
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
        }
      }
    }

    function draw() {
      requestAnimationFrame(draw);

      // Resize the canvas in case the browser window has been resized
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      radius = Math.min(canvas.width, canvas.height) / 4;

      updateCoordinates();

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      renderParticles();
      renderRing(ringCoordinates, "#fff");
      adjustLogoSize();
    }

    draw();
  }, [analyser, frequencyArray]);

  function handlePlay() {
    audioContext?.state === "suspended" && audioContext.resume();
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        width={window.innerWidth}
        height={window.innerHeight}
      ></canvas>
      <div className="logo-wrapper">
        <div className="logo" ref={logoRef}></div>
      </div>
      <div className="audio-wrapper">
        <Uploader audioRef={audioRef} />
        <audio
          ref={audioRef}
          src="royalty.mp3"
          controls
          onPlay={handlePlay}
        ></audio>
      </div>
    </>
  );
}

export default App;
