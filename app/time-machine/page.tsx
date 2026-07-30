import { TimeMachineStudio } from "./_components/TimeMachineStudio";

export const metadata = {
  title: "Time Machine — Zinolt",
  description:
    "Turn a ticker + year + amount into a 9:16 animated video showing what your investment would be worth today.",
};

export default function TimeMachinePage() {
  return <TimeMachineStudio />;
}
