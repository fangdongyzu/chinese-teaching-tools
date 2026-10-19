// Register future activity interfaces here. Keep their Firestore writes protected
// by rules, and identify browser-reported validation in the teacher interface.
export const ACTIVITIES = [
  {
    id: "stroke-order",
    name: "Stroke order practice",
    chinese: "筆順練習",
    icon: "筆",
    description:
      "Assign Chinese text and a repetition target. Students trace or write each character; recorded attempts count toward submission.",
    status: "ready",
  },
];
export const activityName = (id) =>
  ACTIVITIES.find((a) => a.id === id)?.name || id;
