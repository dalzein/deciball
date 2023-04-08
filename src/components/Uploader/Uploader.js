import React, { useState } from "react";
import "./Uploader.css";

function Uploader({ audioRef }) {
  const [{ title }, setTrackInfo] = useState({ title: "" });

  function handleChange(e) {
    if (e.target.files[0]) {
      audioRef.current.src = URL.createObjectURL(e.target.files[0]);

      // Try to read the file tags and and set the track title and artist
      window.jsmediatags.read(e.target.files[0], {
        onSuccess: (tag) => {
          if (tag.tags.title) {
            setTrackInfo({ title: tag.tags.title });
          } else {
            setTrackInfo({
              title: e.target.files[0].name,
            });
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
      <input
        id="file"
        type="file"
        accept=".mp3,audio/*"
        onChange={handleChange}
      ></input>
      <label htmlFor="file">
        <span>{title ? "Change" : "Choose"} file</span>
      </label>
      {title && (
        <div className="track-info">
          <span className="title">{title}</span>
        </div>
      )}
    </div>
  );
}

export default Uploader;
