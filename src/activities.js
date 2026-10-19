// Add future activity modules here and implement their server-side validator in
// functions/activities. Keep completion writes on the server.
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
