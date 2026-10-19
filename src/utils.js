export const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const timeValue = (value) =>
  value?.toMillis?.() ?? (typeof value === "number" ? value : 0);
export const dateLabel = (value) =>
  timeValue(value)
    ? new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(timeValue(value))
    : "No due date";
export const duration = (ms) =>
  `${Math.floor((ms || 0) / 60000)}m ${Math.floor(((ms || 0) % 60000) / 1000)}s`;
export const progress = (enrollment) => {
  const target = enrollment.characters.length * enrollment.repetitions;
  const done = enrollment.counts.reduce(
    (a, b) => a + Math.min(b, enrollment.repetitions),
    0,
  );
  return {
    done,
    target,
    percent: target ? Math.round((done / target) * 100) : 0,
  };
};
export function toast(message, error = false) {
  const target = document.getElementById("toast");
  target.textContent = message;
  target.className = `visible ${error ? "error" : ""}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (target.className = ""), 6500);
}
export const errorMessage = (error) =>
  String(error?.message || "Something went wrong. Please try again.").replace(
    /^Firebase:\s*/,
    "",
  );
export function csv(rows) {
  return rows
    .map((row) =>
      row
        .map((value) => {
          let s = String(value ?? "");
          if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
          return '"' + s.replaceAll('"', '""') + '"';
        })
        .join(","),
    )
    .join("\r\n");
}
