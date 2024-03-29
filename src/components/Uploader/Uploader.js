import React, { useState } from "react";
import styles from "./Uploader.module.css";

export default function Uploader({ audioRef }) {
  const [{ title }, setTrackInfo] = useState({ title: "Royalty (ft. Neoni)" });

  const handleChange = (e) => {
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
          setTrackInfo({ title: e.target.files[0].name });
        },
      });
    }
  };

  return (
    <div className={styles.uploader}>
      <input
        id="file"
        type="file"
        accept="audio/*"
        onChange={handleChange}
      ></input>
      <label htmlFor="file">
        <span>Upload track</span>
      </label>
      {title && (
        <div className={styles.trackInfo}>
          <span className={styles.title}>{title}</span>
        </div>
      )}
    </div>
  );
}
