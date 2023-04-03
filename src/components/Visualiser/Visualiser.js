import React, { useEffect, useRef, useState } from "react";
import Playback from "../Uploader/Uploader";
import "./Visualiser.css";

let audioSource = null;
function Visualiser() {
  const [{ audioContext, analyser, frequencyArray }, setAudioData] = useState({
    audioContext: null,
    analyser: null,
    frequencyArray: new Uint8Array(4096),
  });
  const canvasRef = useRef(null);
  const audioRef = useRef(null);
  const totalRingPoints = 32;

  // Set up audio context
  useEffect(() => {
    if (!audioSource) {
      // Create audio context
      const audioElement = audioRef.current;
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const newAudioContext = new AudioContext();
      audioSource = newAudioContext.createMediaElementSource(audioElement);

      // Create analyser
      const newAnalyser = newAudioContext.createAnalyser();
      newAnalyser.fftSize = 8192;
      const newFrequencyArray = new Uint8Array(newAnalyser.frequencyBinCount);
      audioSource.connect(newAnalyser);
      newAnalyser.connect(newAudioContext.destination);

      setAudioData({
        audioContext: newAudioContext,
        analyser: newAnalyser,
        frequencyArray: newFrequencyArray,
      });
    }
  }, []);

  // Set up canvas visualiser
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let radius = Math.min(canvas.width / 3, 150);
    const ringCoordinates = [];
    const secondaryRingCoordinates = [];
    const particleCoordinates = [];

    let currentLoudness = 0;

    // Set up the empty 2d particle array for the flying particles
    for (let angle = 0; angle < 360; angle += 1) {
      particleCoordinates.push({
        particleCoordinateArray: [],
        angle: angle,
      });
    }

    // Initialise ring points
    for (let angle = 270; angle > -90; angle -= 360 / totalRingPoints) {
      const pointData = JSON.stringify({
        angle: angle,
        x: (canvas.width / 2) * Math.cos((-angle * Math.PI) / 180),
        y: (canvas.height / 2) * Math.sin((-angle * Math.PI) / 180),
        distanceFactor: 1,
      });

      ringCoordinates.push(JSON.parse(pointData));
      secondaryRingCoordinates.push(JSON.parse(pointData));
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
    function renderRing(coordinateArray, fillColour, outline = false) {
      if (outline) {
        ctx.shadowBlur = 20;
        ctx.shadowColor = "rgba(255, 255, 255, 1)";
        ctx.lineWidth = 0;
        ctx.strokeStyle = "#fff";
      } else {
        ctx.shadowBlur = 20;
        ctx.shadowColor = fillColour;
        ctx.strokeStyle = "transparent";
      }
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
      ctx.stroke();
      ctx.fill();
    }

    // Render main black circle that reacts to loudness
    function renderCircle() {
      ctx.beginPath();
      ctx.arc(
        canvas.width / 2,
        canvas.height / 2,
        radius * currentLoudness,
        0,
        2 * Math.PI
      );
      ctx.strokeStyle = "#fff";
      ctx.shadowBlur = 20;
      ctx.shadowColor = "#fff";
      ctx.lineWidth = 20;
      ctx.fillStyle = "#000";
      ctx.stroke();
      ctx.fill();
    }

    // Update the coordinates of the rings and particles
    function updateCoordinates() {
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      analyser && analyser.getByteFrequencyData(frequencyArray);

      // Iterate through the coordinates making up the left half of the rings
      // The right half will just be a mirror of the left half
      for (let i = 0; i <= totalRingPoints / 2; i++) {
        const audioValue = frequencyArray[i * 2] / 255;

        const baseDistanceFactor = 1 + Math.pow(audioValue, 2);

        ringCoordinates[i].distanceFactor = Math.max(
          1,
          0.8 * baseDistanceFactor
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

        secondaryRingCoordinates[i].distanceFactor = Math.max(
          1,
          0.85 * (1 + Math.pow(audioValue, 3))
        );
        secondaryRingCoordinates[i].x =
          centerX +
          radius *
            Math.cos((-secondaryRingCoordinates[i].angle * Math.PI) / 180) *
            secondaryRingCoordinates[i].distanceFactor;
        secondaryRingCoordinates[i].y =
          centerY +
          radius *
            Math.sin((-secondaryRingCoordinates[i].angle * Math.PI) / 180) *
            secondaryRingCoordinates[i].distanceFactor;

        // Right half ring coordinates are just a mirror of the left
        if (i > 0) {
          ringCoordinates[totalRingPoints - i].x =
            2 * centerX - ringCoordinates[i].x;
          ringCoordinates[totalRingPoints - i].y = ringCoordinates[i].y;

          secondaryRingCoordinates[totalRingPoints - i].x =
            2 * centerX - secondaryRingCoordinates[i].x;
          secondaryRingCoordinates[totalRingPoints - i].y =
            secondaryRingCoordinates[i].y;
        }
      }

      // The "loudness" will be the average distanceFactor value of the ring coordinates
      currentLoudness =
        ringCoordinates
          .map((x) => x.distanceFactor)
          .reduce((a, b) => a + b, 0) / ringCoordinates.length;

      updateParticleCoordinates(centerX, centerY, radius);
    }

    // Updates the coordinates of the flying particles
    function updateParticleCoordinates(centerX, centerY, radius) {
      particleCoordinates.forEach((position) => {
        // As the loudness increases, the chance of a particle being generated should increase
        if (Math.pow(currentLoudness, 5) > Math.random() * 50) {
          position.particleCoordinateArray.push({
            x: centerX + Math.sin((position.angle * Math.PI) / 180) * radius,
            y: centerY + Math.cos((position.angle * Math.PI) / 180) * radius,
            size: Math.pow(Math.random(), 2) * 3,
            opacity: Math.pow(Math.random(), 2),
            angle: position.angle,
          });
        }

        // Update the x and y coordinates for the particle
        position.particleCoordinateArray.forEach((particle, index) => {
          const angleChange = Math.random() < 0.5 ? -5 : 5;
          particle.angle =
            particle.angle + angleChange < position.angle - 60 ||
            particle.angle + angleChange > position.angle + 60
              ? particle.angle
              : particle.angle + angleChange;
          particle.speed = Math.pow(currentLoudness, 10) + 0.5;
          particle.x +=
            Math.sin((particle.angle * Math.PI) / 180) * particle.speed;
          particle.y +=
            Math.cos((particle.angle * Math.PI) / 180) * particle.speed;

          // If the particle has left the screen, remove it from the array as we no longer need to track it
          if (
            particle.x >= canvas.width ||
            particle.x <= 0 ||
            particle.y >= canvas.height ||
            particle.y <= 0
          ) {
            position.particleCoordinateArray.splice(index, 1);
          }
        });
      });
    }

    function draw() {
      requestAnimationFrame(draw);

      // Resize the canvas in case the browser window has been resized
      // This is a cleaner way of doing it as we don't need to listen for the resize event or interrupt the animation
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      radius = Math.min(canvas.width / 3, 150);

      updateCoordinates();

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      renderParticles();

      renderRing(
        secondaryRingCoordinates,
        `hsl(${360 * Math.pow(currentLoudness, 2) + 200}, 100%, 50%)`
      );
      renderRing(ringCoordinates, "#fff", true);
      renderCircle();
    }

    draw();
  }, [analyser, frequencyArray]);

  function handlePlay() {
    audioContext.state === "suspended" && audioContext.resume();
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        width={window.innerWidth}
        height={window.innerHeight}
      ></canvas>
      <Playback audioRef={audioRef} />
      <div className="audio-wrapper">
        <audio ref={audioRef} controls onPlay={handlePlay}></audio>
      </div>
    </>
  );
}

export default Visualiser;
