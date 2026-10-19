import HanziWriter from "hanzi-writer";
import { escape as e, toast, errorMessage, progress } from "../utils.js";
const cache = new Map();
let engine = null;
let cleanupCurrent = () => {};
async function loadData(char) {
  if (!cache.has(char))
    cache.set(
      char,
      fetch(
        `https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/${encodeURIComponent(char)}.json`,
        { signal: AbortSignal.timeout(12000) },
      )
        .then((r) => {
          if (!r.ok)
            throw new Error(
              "Stroke data could not be loaded. Check your connection.",
            );
          return r.json();
        })
        .catch((error) => {
          cache.delete(char);
          throw error;
        }),
    );
  return cache.get(char);
}
export const cleanupPractice = () => cleanupCurrent();
export async function mountPractice(root, assignment, enrollment, api) {
  cleanupCurrent();
  let index = Math.max(
    0,
    enrollment.counts.findIndex((c) => c < assignment.repetitions),
  );
  let watch = enrollment.status === "submitted";
  let revision = 0,
    attemptId = null,
    paths = [],
    mistakes = 0,
    pending = false,
    completePaths = false,
    data = null,
    loading = false;
  const p = progress(enrollment);
  root.innerHTML = `<div class="practice-heading"><div><button class="text-btn" id="back-to-work">← My assignments</button><h1>${e(assignment.title)}</h1><p class="muted">${e(assignment.className)} ${assignment.className ? "·" : ""} ${assignment.repetitions} repetitions per character</p></div><span class="badge">${assignment.mode === "write" ? "Write from memory" : "Guided tracing"}</span></div><section class="panel"><div class="panel-heading"><span class="muted" id="practice-total" style="font-size:11px">${p.done} / ${p.target} repetitions recorded</span><span class="badge ${enrollment.status === "submitted" ? "" : "gray"}" id="submission-label">${enrollment.status === "submitted" ? "Submitted" : "In progress"}</span></div><div class="mode-switch" role="group" aria-label="Practice view"><button id="watch-mode">▷ Watch</button><button id="practice-mode">✎ ${assignment.mode === "write" ? "Write" : "Trace"} & record</button></div><div class="practice-layout"><div class="practice-canvas"><div class="board" id="practice-board" aria-label="Handwriting area"><svg class="grid-svg" viewBox="0 0 360 360" aria-hidden="true"><path d="M180 0v360M0 180h360M0 0l360 360M360 0 0 360"/></svg><div id="writer-target"></div><div id="board-message">Preparing practice…</div></div><nav class="char-nav" aria-label="Character navigation"><button class="btn" id="prev-char" aria-label="Previous character">←</button><div id="practice-characters" class="character-list"></div><button class="btn" id="next-char" aria-label="Next character">→</button></nav></div><div class="practice-side"><div class="practice-count"><span class="practice-current" id="practice-character"></span><div><strong id="repetition-count"></strong><small>recorded repetitions</small></div></div><progress id="repetition-progress" aria-label="Repetitions completed"></progress><div class="practice-facts"><div><strong id="stroke-counter">0 / –</strong><span>strokes</span></div><div><strong id="practice-mistakes">0</strong><span>try-agains</span></div></div><button id="play-strokes" class="btn primary">▷ Play stroke order</button><button id="repeat-character" class="btn">↺ Restart this repetition</button><button id="retry-record" class="btn primary" hidden>Retry saving this repetition</button><button id="submit-work" class="btn primary">Submit assignment</button><div class="practice-feedback" id="practice-feedback" role="status" aria-live="polite"></div></div></div>${assignment.instructions ? `<p class="muted" style="white-space:pre-wrap;border-top:1px solid var(--line);padding-top:17px;margin-top:22px">${e(assignment.instructions)}</p>` : ""}</section>`;
  const $ = (id) => root.querySelector(`#${id}`);
  const feedback = (message) => ($("practice-feedback").textContent = message);
  function update() {
    $("practice-character").textContent = assignment.characters[index];
    $("repetition-count").textContent =
      `${enrollment.counts[index]} / ${assignment.repetitions}`;
    $("repetition-progress").max = assignment.repetitions;
    $("repetition-progress").value = enrollment.counts[index];
    $("practice-total").textContent =
      `${progress(enrollment).done} / ${progress(enrollment).target} repetitions recorded`;
    $("prev-char").disabled = index === 0 || pending || loading;
    $("next-char").disabled =
      index === assignment.characters.length - 1 || pending || loading;
    $("submit-work").disabled =
      pending ||
      enrollment.status === "submitted" ||
      !enrollment.counts.every((c) => c >= assignment.repetitions);
    $("submit-work").textContent =
      enrollment.status === "submitted"
        ? "✓ Assignment submitted"
        : "Submit assignment";
    $("watch-mode").classList.toggle("active", watch);
    $("practice-mode").classList.toggle("active", !watch);
    $("practice-mode").disabled =
      pending || loading || enrollment.status === "submitted";
    $("watch-mode").disabled = pending || loading;
    $("play-strokes").hidden = !watch;
    $("repeat-character").hidden =
      watch || enrollment.counts[index] >= assignment.repetitions;
    $("repeat-character").disabled = pending || loading;
    $("practice-characters").innerHTML = assignment.characters
      .map(
        (char, i) =>
          `<button aria-label="Character ${i + 1}: ${e(char)}, ${enrollment.counts[i]} of ${assignment.repetitions}" data-character="${i}" aria-current="${i === index}" class="${enrollment.counts[i] >= assignment.repetitions ? "complete" : ""}" ${pending || loading ? "disabled" : ""}>${e(char)}</button>`,
      )
      .join("");
    const list = $("practice-characters"),
      selected = list.querySelector('[aria-current="true"]');
    if (selected)
      list.scrollLeft =
        selected.offsetLeft -
        list.offsetLeft -
        list.clientWidth / 2 +
        selected.clientWidth / 2;
  }
  async function record() {
    if (!attemptId || !completePaths || pending) return;
    pending = true;
    update();
    $("retry-record").hidden = true;
    feedback("Checking strokes and saving your repetition…");
    const savedIndex = index;
    try {
      const result = await api.call("completeAttempt", {
        attemptId,
        paths,
        mistakes,
      });
      enrollment.counts = result.counts;
      attemptId = null;
      completePaths = false;
      feedback(
        `✓ Repetition ${enrollment.counts[savedIndex]} of ${assignment.repetitions} recorded. ${enrollment.counts.every((c) => c >= assignment.repetitions) ? "Every character is complete. Submit your assignment when ready." : "Continue with another repetition."}`,
      );
      $("repeat-character").textContent =
        enrollment.counts[savedIndex] < assignment.repetitions
          ? "Continue: next repetition"
          : "↺ Restart this repetition";
      await api.refresh();
    } catch (error) {
      feedback(errorMessage(error));
      $("retry-record").hidden = false;
    } finally {
      pending = false;
      update();
    }
  }
  async function prepare() {
    const generation = ++revision;
    loading = true;
    attemptId = null;
    paths = [];
    mistakes = 0;
    completePaths = false;
    data = null;
    if (engine) {
      engine.writer.cancelQuiz();
      engine.writer.pauseAnimation();
    }
    update();
    $("retry-record").hidden = true;
    $("board-message").hidden = false;
    $("board-message").textContent = "Preparing practice…";
    $("practice-mistakes").textContent = "0";
    $("stroke-counter").textContent = "0 / –";
    $("repeat-character").textContent = "↺ Restart this repetition";
    try {
      data = await loadData(assignment.characters[index]);
      if (generation !== revision) return;
      const size = $("practice-board").clientWidth;
      if (!engine) {
        const target = document.createElement("div");
        engine = {
          target,
          writer: new HanziWriter(target, {
            width: size,
            height: size,
            padding: size * 0.12,
            showCharacter: false,
            showOutline: false,
            strokeColor: "#345448",
            outlineColor: "#dfe5d5",
            drawingColor: "#345448",
            highlightColor: "#bd714e",
            drawingWidth: 6,
            strokeFadeDuration: 140,
            delayBetweenStrokes: 250,
            charDataLoader: loadData,
          }),
        };
      }
      $("writer-target").append(engine.target);
      engine.writer.updateDimensions({
        width: size,
        height: size,
        padding: size * 0.12,
      });
      await engine.writer.setCharacter(assignment.characters[index]);
      if (generation !== revision) return;
      await engine.writer.hideCharacter({ duration: 0 });
      if (generation !== revision) return;
      if (watch || assignment.mode === "trace")
        await engine.writer.showOutline({ duration: 0 });
      else await engine.writer.hideOutline({ duration: 0 });
      if (generation !== revision) return;
      if (watch) {
        await engine.writer.showCharacter({ duration: 0 });
        feedback("Watch mode does not count toward your assignment.");
      } else if (
        enrollment.status === "submitted" ||
        enrollment.counts[index] >= assignment.repetitions
      ) {
        feedback(
          enrollment.status === "submitted"
            ? "This assignment has been submitted."
            : "This character has met its target. Choose another character or submit your assignment.",
        );
      } else {
        if (api.preview) {
          feedback("Interface preview only. Sign in to record real practice.");
        } else {
          const attempt = await api.call("beginAttempt", {
            assignmentId: assignment.id,
            characterIndex: index,
          });
          if (generation !== revision) return;
          attemptId = attempt.attemptId;
          engine.writer.quiz({
            showHintAfterMisses: assignment.mode === "trace" ? 2 : false,
            acceptBackwardsStrokes: false,
            markStrokeCorrectAfterMisses: false,
            highlightOnComplete: assignment.mode === "trace",
            onCorrectStroke(result) {
              if (generation !== revision) return;
              const raw = result.drawnPath.points;
              const sampled =
                raw.length > 384
                  ? Array.from(
                      { length: 384 },
                      (_, i) => raw[Math.round((i * (raw.length - 1)) / 383)],
                    )
                  : raw;
              paths[result.strokeNum] = sampled.map((p) => [p.x, p.y]);
              $("stroke-counter").textContent =
                `${result.strokeNum + 1} / ${data.strokes.length}`;
              feedback(
                result.strokesRemaining
                  ? `${result.strokesRemaining} strokes to go.`
                  : "Character complete.",
              );
            },
            onMistake(result) {
              if (generation !== revision) return;
              mistakes = result.totalMistakes;
              $("practice-mistakes").textContent = mistakes;
              feedback(
                "Try that stroke again. Check its shape, direction, and order.",
              );
            },
            onComplete() {
              if (generation !== revision) return;
              completePaths = true;
              record();
            },
          });
          feedback(
            assignment.mode === "trace"
              ? "Trace each stroke in order."
              : "Write each stroke in order. No outlines or hints.",
          );
        }
      }
      if (generation !== revision) return;
      $("board-message").hidden = true;
      $("stroke-counter").textContent = `0 / ${data.strokes.length}`;
    } catch (error) {
      if (generation !== revision) return;
      $("board-message").textContent = errorMessage(error);
      feedback("Use Restart to retry, or return to your assignments.");
    } finally {
      if (generation === revision) {
        loading = false;
        update();
      }
    }
  }
  $("prev-char").onclick = () => {
    if (index > 0) {
      index--;
      prepare();
    }
  };
  $("next-char").onclick = () => {
    if (index < assignment.characters.length - 1) {
      index++;
      prepare();
    }
  };
  $("practice-characters").onclick = (event) => {
    const b = event.target.closest("[data-character]");
    if (b && !pending && !loading) {
      index = Number(b.dataset.character);
      prepare();
    }
  };
  $("watch-mode").onclick = () => {
    watch = true;
    prepare();
  };
  $("practice-mode").onclick = () => {
    watch = false;
    prepare();
  };
  $("play-strokes").onclick = () => {
    if (engine && data) engine.writer.animateCharacter();
  };
  $("repeat-character").onclick = () => prepare();
  $("retry-record").onclick = () => record();
  $("back-to-work").onclick = () => {
    cleanupCurrent();
    api.back();
  };
  $("submit-work").onclick = async () => {
    pending = true;
    update();
    try {
      if (api.preview) throw new Error("Sign in to submit real work.");
      await api.call("submitAssignment", { assignmentId: assignment.id });
      enrollment.status = "submitted";
      $("submission-label").textContent = "Submitted";
      feedback("✓ Submitted. Your teacher can now review your results.");
      toast("Assignment submitted to your teacher.");
      await api.refresh();
    } catch (error) {
      feedback(errorMessage(error));
    } finally {
      pending = false;
      update();
    }
  };
  const observer = new ResizeObserver(() => {
    if (engine) {
      const size = $("practice-board").clientWidth;
      engine.writer.updateDimensions({
        width: size,
        height: size,
        padding: size * 0.12,
      });
    }
  });
  observer.observe($("practice-board"));
  cleanupCurrent = () => {
    revision++;
    observer.disconnect();
    if (engine) {
      engine.writer.cancelQuiz();
      engine.writer.pauseAnimation();
    }
  };
  await prepare();
}
