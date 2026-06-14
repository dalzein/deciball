import { parseBlob } from "music-metadata";
import { ChangeEvent, RefObject, useState } from "react";
import styles from "./Uploader.module.css";

type UploaderProps = {
  audioRef: RefObject<HTMLAudioElement>;
};

export default function Uploader({ audioRef }: UploaderProps) {
  const [title, setTitle] = useState("Royalty (ft. Neoni)");

  const handleChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const audioElement = audioRef.current;
    const file = e.target.files?.[0];

    if (file && audioElement) {
      audioElement.src = URL.createObjectURL(file);

      // Title the track from its metadata, falling back to the file name.
      const metadata = await parseBlob(file);
      setTitle(metadata.common.title || file.name);
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
