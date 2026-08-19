/**
 * Isolated Remotion entry — only Ranking compositions registered here.
 *
 * Used by the CLI (`npx remotion render`) so unrelated sibling compositions
 * (Reel, tweet, wire-carousel, …) don't get bundled and don't fire their
 * own module-load `delayRender` calls that block a video render.
 */
import React from "react";
import { registerRoot, Composition } from "remotion";
import {
  RankingComposition,
  rankingDefaultProps,
  RK_FPS,
  RK_HEIGHT,
  RK_TOTAL_FRAMES,
  RK_WIDTH,
} from "./ranking/Ranking";
import {
  RankingHorizontalComposition,
  rankingHorizontalDefaultProps,
} from "./ranking/RankingHorizontal";

const Root: React.FC = () => (
  <>
    <Composition
      id="Ranking"
      component={RankingComposition}
      durationInFrames={RK_TOTAL_FRAMES}
      fps={RK_FPS}
      width={RK_WIDTH}
      height={RK_HEIGHT}
      defaultProps={rankingDefaultProps}
    />
    <Composition
      id="RankingHorizontal"
      component={RankingHorizontalComposition}
      durationInFrames={RK_TOTAL_FRAMES}
      fps={RK_FPS}
      width={RK_WIDTH}
      height={RK_HEIGHT}
      defaultProps={rankingHorizontalDefaultProps}
    />
  </>
);

registerRoot(Root);
