/**
 * Isolated Remotion entry — only the ConceptReel composition.
 *
 * Used by `scripts/build-concept-reel.ts` so unrelated sibling compositions
 * (Reel, tweet, wire, ranking, story-card, …) don't get bundled and don't
 * fire their own module-load `delayRender` calls that block the render.
 */
import React from "react";
import { registerRoot, Composition } from "remotion";
import {
  ConceptReelComposition,
  conceptReelDefaultProps,
  computeConceptReelDurationFrames,
  CR_FPS,
  CR_WIDTH,
  CR_HEIGHT,
  CR_DEFAULT_DURATION_FRAMES,
  type ConceptReelProps,
} from "./concept-reel/ConceptReelComposition";

const Root: React.FC = () => (
  <Composition
    id="ConceptReel"
    component={ConceptReelComposition}
    durationInFrames={CR_DEFAULT_DURATION_FRAMES}
    fps={CR_FPS}
    width={CR_WIDTH}
    height={CR_HEIGHT}
    defaultProps={conceptReelDefaultProps}
    calculateMetadata={({ props }) => {
      const p = props as ConceptReelProps;
      return {
        durationInFrames: computeConceptReelDurationFrames(p.words, CR_FPS),
        fps: CR_FPS,
        width: CR_WIDTH,
        height: CR_HEIGHT,
      };
    }}
  />
);

registerRoot(Root);
