# Deciball

A bass-focused audio visualiser in the style of Trap Nation.

Frequency analysis and cleansing, animation logic, particle effects, etc are all completely custom and done using loads of math, the native `Web Audio API`, and native `HTML <canvas>`.

The app allows you to upload an audio file and should accept most formats.

The frequency range represented is from ~ 10 hz to ~ 145 hz top to bottom, so tracks need to have bass in them or you'll get bored.

The original plan for this project was to integrate it with Spotify, but there's no way to get the frequency data of the tracks and there's no browser API for accessing device/system output audio (for good reason).

## Frequency range

1. The FFT size is set to 8192, which provides a 4096 bin count - this should ideally be as high as possible since we're magnifying the bass range, and going to 16384 seems to destroy performance
2. For precision, the app uses `getFloatFrequencyData()` (see the [docs](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/getFloatFrequencyData)) - this provides the decibals relative to full scale (dBFS) at each binned frequency, where the values range from -Infinity to 0, with 0 being the loudest
3. The sample rate is set to 44100 Hz, which gives us a 22050 hz frequency range divided into the 4096 bins to play with, which equates to roughly 5.38 hz per bin
4. We're only taking the first 27 bins and then skipping the first two as nothing generally happens under 10hz, which gives us a range of ~ 10 hz to ~ 145 hz

## Built with

- `Web Audio API` for audio frequency analysis
- `TypeScript` because types are nice
- `React` for the UI
- `Vite` as the build tool
- `music-metadata` for extracting the title metadata from the uploaded track
- `HTML <canvas>` and loads of math for the animation logic

## Running locally

1. npm install
2. npm run dev
