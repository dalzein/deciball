import React, { useState } from "react";
import "./Uploader.css";

function Uploader({ audioRef }) {
  const [{ title, artist }, setTrackInfo] = useState({ title: "", artist: "" });

  function handleChange(e) {
    if (e.target.files[0]) {
      audioRef.current.src = URL.createObjectURL(e.target.files[0]);

      window.jsmediatags.read(e.target.files[0], {
        onSuccess: function (tag) {
          setTrackInfo({ title: tag.tags.title, artist: tag.tags.artist });
        },
        onError: function (error) {
          console.log(error);
        },
      });
    }
  }

  return (
    <div className="uploader">
      <div className="track-info">
        <h2 className="title">{title}</h2>
        <h3 className="artist">{artist}</h3>
      </div>
      <input
        id="file"
        type="file"
        accept=".mp3,audio/*"
        onChange={handleChange}
      ></input>
      <label htmlFor="file">
        <span>Choose file</span>
      </label>
    </div>
  );
}

export default Uploader;
