import React, { useState } from "react";
import "./Uploader.css";

function Uploader({ audioRef }) {
  const [{ title, artist }, setTrackInfo] = useState({ title: "", artist: "" });

  function handleChange(e) {
    if (e.target.files[0]) {
      audioRef.current.src = URL.createObjectURL(e.target.files[0]);

      // Try to read the file tags and and set the track title and artist
      window.jsmediatags.read(e.target.files[0], {
        onSuccess: (tag) => {
          if (tag.tags.title) {
            setTrackInfo({ title: tag.tags.title, artist: tag.tags.artist });
          } else {
            setTrackInfo({ title: "Unknown", artist: tag.tags.artist });
          }
        },
        onError: (error) => {
          console.log(error);
          setTrackInfo({ title: "Unknown", artist: "" });
        },
      });
    }
  }

  return (
    <div className="uploader">
      {title && (
        <div className="track-info">
          <h2 className="title">{title}</h2>
          <h3 className="artist">{artist}</h3>
        </div>
      )}
      <input
        id="file"
        type="file"
        accept=".mp3,audio/*"
        onChange={handleChange}
      ></input>
      <label htmlFor="file">
        <span>{title || artist ? "Change" : "Choose"} file</span>
        <i class="fa-solid fa-upload"></i>
      </label>
    </div>
  );
}

export default Uploader;
