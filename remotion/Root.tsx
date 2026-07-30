import { Composition } from "remotion";
import { TEMPLATES } from "../lib/templates";
import { Reel, reelDefaultProps } from "./Reel";
import { LetterboxReel, letterboxDefaultProps } from "./LetterboxReel";
import {
  InCardComposition,
  inCardDefaultProps,
} from "./tweet/InCardComposition";
import {
  StackedComposition,
  stackedDefaultProps,
} from "./tweet/StackedComposition";
import {
  TimeMachine,
  timeMachineDefaultProps,
  TM_FPS,
  TM_HEIGHT,
  TM_TOTAL_FRAMES,
  TM_WIDTH,
} from "./time-machine/TimeMachine";

const TWEET_FPS = 30;
const TWEET_DURATION = 30 * 7;
const STACKED_MAX_DURATION = 30 * 12;

const TWEET_ASPECTS = [
  { id: "TweetInCard9x16", aspect: "9x16" as const, width: 1080, height: 1920 },
  { id: "TweetInCard1x1", aspect: "1x1" as const, width: 1080, height: 1080 },
  { id: "TweetInCard16x9", aspect: "16x9" as const, width: 1920, height: 1080 },
];

const STACKED_ASPECTS = [
  { id: "TweetStacked9x16", aspect: "9x16" as const, width: 1080, height: 1920 },
  { id: "TweetStacked1x1", aspect: "1x1" as const, width: 1080, height: 1080 },
  { id: "TweetStacked16x9", aspect: "16x9" as const, width: 1920, height: 1080 },
];

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="TimeMachine"
      component={TimeMachine}
      durationInFrames={TM_TOTAL_FRAMES}
      fps={TM_FPS}
      width={TM_WIDTH}
      height={TM_HEIGHT}
      defaultProps={timeMachineDefaultProps}
    />
    {TEMPLATES.filter(
      (t) => t.id !== "letterbox" && t.id !== "tweet-video" && t.id !== "time-machine",
    ).map((t) => (
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
    <Composition
      id="LetterboxReel"
      component={LetterboxReel}
      durationInFrames={450}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={letterboxDefaultProps}
    />
    {TWEET_ASPECTS.map(({ id, aspect, width, height }) => (
      <Composition
        key={id}
        id={id}
        component={InCardComposition}
        durationInFrames={TWEET_DURATION}
        fps={TWEET_FPS}
        width={width}
        height={height}
        defaultProps={{ ...inCardDefaultProps, aspect }}
      />
    ))}
    {STACKED_ASPECTS.map(({ id, aspect, width, height }) => (
      <Composition
        key={id}
        id={id}
        component={StackedComposition}
        durationInFrames={STACKED_MAX_DURATION}
        fps={TWEET_FPS}
        width={width}
        height={height}
        defaultProps={{ ...stackedDefaultProps, aspect }}
      />
    ))}
  </>
);
