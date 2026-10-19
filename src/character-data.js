const cache = new Map();
export async function loadCharacterData(char) {
  if (!cache.has(char))
    cache.set(
      char,
      fetch(
        `https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/${encodeURIComponent(char)}.json`,
        { signal: AbortSignal.timeout(12000) },
      )
        .then(async (response) => {
          if (!response.ok)
            throw new Error(
              `Stroke data is unavailable for “${char}”. Remove it from the assignment or try again when connected.`,
            );
          const data = await response.json();
          if (
            !Array.isArray(data.strokes) ||
            !Array.isArray(data.medians) ||
            !data.strokes.length
          )
            throw new Error("Invalid character data.");
          return data;
        })
        .catch((error) => {
          cache.delete(char);
          throw error;
        }),
    );
  return cache.get(char);
}
