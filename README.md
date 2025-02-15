# Deciball

A bass-focused audio visualiser in the style of Trap Nation.

Frequency analysis and cleansing, animation logic, particle effects, etc are all completely custom and done using a bunch of math, the native `Web Audio API`, and native `HTML <canvas>`.

The app allows you to upload an audio file and should accept most formats. `music-metadata` is used to extract the title metadata from the uploaded track.

The frequency range represented is from ~ 10 Hz to ~ 145 Hz top to bottom, so tracks need to have bass in them or you'll get bored.

The original plan for this project was to integrate it with Spotify, but there's no way to get the frequency data of the tracks and there's no browser API for accessing device/system output audio (for good reason).

## Frequency range

The FFT size is set to 8192, which provides a 4096 bin count. This should ideally be as high as possible since we're magnifying the bass range, and going to 16384 seems to destroy performance.

For precision, the app uses `getFloatFrequencyData()`. This provides the decibals relative to full scale (dBFS) at each binned frequency, where the values range from -Infinity to 0, with 0 being the loudest.

The sample rate is set to 44100 Hz, which gives us a 22050 Hz frequency range divided into the 4096 bins to play with, which equates to roughly 5.38 hz per bin.

We're only taking the first 27 bins and then skipping the first two as nothing generally happens under 10 Hz, which gives us a range of ~ 10 Hz to ~ 145 Hz.

## Built with

- `TypeScript`
- `React`
- `Vite`
- `music-metadata`

## Running locally

1. npm install
2. npm run dev
