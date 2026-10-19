export function tonePinyin(value) {
  return value.replace(/([a-züv:]+)([1-5])/gi, (_, raw, number) => {
    const syllable = raw.replace(/u:|v/gi, (s) =>
      s[0] === s[0].toUpperCase() ? "Ü" : "ü",
    );
    const lower = syllable.toLowerCase();
    const tone = Number(number);
    if (tone === 5) return syllable;
    let index = lower.indexOf("a");
    if (index < 0) index = lower.indexOf("e");
    if (index < 0 && lower.includes("ou")) index = lower.indexOf("o");
    if (index < 0)
      for (let i = lower.length - 1; i >= 0; i--)
        if ("iouü".includes(lower[i])) {
          index = i;
          break;
        }
    if (index < 0) {
      if (/^(m|n|ng)$/.test(lower))
        return (
          syllable[0] +
          ["\u0304", "\u0301", "\u030c", "\u0300"][tone - 1] +
          syllable.slice(1)
        ).normalize("NFC");
      return syllable;
    }
    const tones = {
      a: "āáǎà",
      e: "ēéěè",
      i: "īíǐì",
      o: "ōóǒò",
      u: "ūúǔù",
      ü: "ǖǘǚǜ",
    };
    let marked = tones[lower[index]][tone - 1];
    if (syllable[index] !== lower[index]) marked = marked.toUpperCase();
    return syllable.slice(0, index) + marked + syllable.slice(index + 1);
  });
}

export function createCharacterDictionary({
  fetcher = (...args) => fetch(...args),
  baseUrl = "/",
} = {}) {
  const cache = new Map();
  return async (char) => {
    if (typeof char !== "string" || [...char].length !== 1) return [];
    const shard = char.codePointAt(0) % 64;
    if (!cache.has(shard))
      cache.set(
        shard,
        fetcher(`${baseUrl}data/character-dictionary/${shard}.json`, {
          signal: AbortSignal.timeout(10000),
        })
          .then(async (r) => {
            if (!r.ok) throw new Error("Dictionary unavailable.");
            const data = await r.json();
            if (!data || typeof data !== "object" || Array.isArray(data))
              throw new Error("Dictionary unavailable.");
            return data;
          })
          .catch((error) => {
            cache.delete(shard);
            throw error;
          }),
      );
    const data = await cache.get(shard);
    return (data[char] || []).map((entry) => ({
      ...entry,
      pinyin: tonePinyin(entry.pinyin),
    }));
  };
}
export const lookupCharacter = createCharacterDictionary({
  baseUrl: import.meta.env?.BASE_URL || "/",
});
