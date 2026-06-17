import { Composition } from "remotion";
import { TEMPLATES } from "../lib/templates";
import { Reel, reelDefaultProps } from "./Reel";

export const RemotionRoot: React.FC = () => (
  <>
    {TEMPLATES.map((t) => (
      <Composition
        key={t.compositionId}
        id={t.compositionId}
        component={Reel}
        durationInFrames={450}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{ ...reelDefaultProps, backgroundSrc: t.background }}
      />
    ))}
  </>
);
