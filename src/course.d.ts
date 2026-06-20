// 3曲の楽曲を条件を満たして連続して演奏する、腕前認定のコース「段位道場」のコース情報

import { Chart, Song } from "./types";

// 条件は楽曲ごとの条件と、3曲通じての条件の2パターンが有る
// また、公開条件を上回る精度で合格すると「金合格」として認定される。この値も保持するが、非公開情報であるため未判明が考えられ、 undefined を許容する。
interface Condition {
  name: string
  operator: '<' | '>='
  value: {
    normal: number, // 合格条件
    gold?: number,   // 金合格条件
  }
}

// 段位道場では、条件を満たせないと途中でゲームが終了する
// そのため、最後の曲が何か分からないままゲームが終了する可能性があり、楽曲情報不明 (ゲーム内では「？？？」と表示)があり得る
interface CoursePart {
  songNumber: Song['number'] | undefined,
  chart: Chart | undefined,
  condition?: Condition[]
}

interface Course {
  part: [CoursePart, CoursePart, CoursePart]
  condition: Condition[]
}
