import React from "react";
import { Img, OffthreadVideo } from "remotion";
import { Video as MediaVideo } from "@remotion/media";
import type { TweetMedia } from "@/lib/tweet-fetch";

const GAP = 2;
const RADIUS = 12;

const boxStyle: React.CSSProperties = {
  overflow: "hidden",
  borderRadius: RADIUS,
  backgroundColor: "#0f1419",
};

export const TweetMediaGrid: React.FC<{
  media: TweetMedia[];
  forRender?: boolean;
}> = ({ media, forRender = false }) => {
  if (media.length === 0) return null;

  const first = media[0];

  // Video/GIF always takes the whole slot (X's real behavior — video tweets
  // don't grid).
  if (first.type === "video" || first.type === "gif") {
    const aspect =
      first.width && first.height ? first.width / first.height : 16 / 9;
    return (
      <div
        style={{
          ...boxStyle,
          width: "100%",
          aspectRatio: `${aspect}`,
          maxHeight: 500,
        }}
      >
        {forRender ? (
          <MediaVideo
            src={first.url}
            muted
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        ) : (
          <OffthreadVideo
            src={first.url}
            muted
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        )}
      </div>
    );
  }

  const photos = media.filter((m) => m.type === "photo");
  if (photos.length === 0) return null;

  if (photos.length === 1) {
    const p = photos[0];
    const aspect = p.width && p.height ? p.width / p.height : 16 / 9;
    return (
      <div
        style={{
          ...boxStyle,
          width: "100%",
          maxHeight: 500,
          aspectRatio: `${aspect}`,
        }}
      >
        <Img
          src={p.url}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
      </div>
    );
  }

  if (photos.length === 2) {
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: GAP,
          aspectRatio: "16 / 9",
        }}
      >
        {photos.map((p, i) => (
          <div key={i} style={boxStyle}>
            <Img
              src={p.url}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
              }}
            />
          </div>
        ))}
      </div>
    );
  }

  if (photos.length === 3) {
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: "1fr 1fr",
          gap: GAP,
          aspectRatio: "16 / 9",
        }}
      >
        <div style={{ ...boxStyle, gridRow: "1 / 3" }}>
          <Img
            src={photos[0].url}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        </div>
        <div style={boxStyle}>
          <Img
            src={photos[1].url}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        </div>
        <div style={boxStyle}>
          <Img
            src={photos[2].url}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: "1fr 1fr",
        gap: GAP,
        aspectRatio: "1 / 1",
      }}
    >
      {photos.slice(0, 4).map((p, i) => (
        <div key={i} style={boxStyle}>
          <Img
            src={p.url}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        </div>
      ))}
    </div>
  );
};
