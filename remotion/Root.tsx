import { Composition } from "remotion";
import { LightRay, lightRayDefaultProps } from "./LightRay";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="LightRay"
      component={LightRay}
      durationInFrames={450}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={lightRayDefaultProps}
    />
  );
};
