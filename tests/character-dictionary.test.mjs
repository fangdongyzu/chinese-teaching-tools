import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  createCharacterDictionary,
  tonePinyin,
} from "../src/character-dictionary.js";

test("pinyin displays tone marks including ü, compound vowels and neutral tones", () => {
  assert.equal(
    tonePinyin("ni3 hao3 nu:3 lve4 liu2 gui4 dou1 de5"),
    "nǐ hǎo nǚ lüè liú guì dōu de",
  );
});
test("bundled dictionary covers both character forms, ordinary readings and alternate pronunciations", async () => {
  let reads = 0;
  const lookup = createCharacterDictionary({
    fetcher: async (url) => {
      reads++;
      return {
        ok: true,
        json: async () =>
          JSON.parse(
            await fs.readFile(
              new URL(`../public${url}`, import.meta.url),
              "utf8",
            ),
          ),
      };
    },
  });
  const ni = await lookup("你");
  assert.equal(ni[0].pinyin, "nǐ");
  assert.match(ni[0].meanings[0], /^bạn/);
  await lookup("你");
  assert.equal(reads, 1);
  assert.equal((await lookup("好"))[0].pinyin, "hǎo");
  assert.ok((await lookup("好")).some((e) => e.pinyin === "hào"));
  assert.equal((await lookup("女"))[0].pinyin, "nǚ");
  for (const char of ["學", "学"]) {
    const entries = await lookup(char);
    assert.equal(entries[0].pinyin, "xué");
    assert.ok(entries[0].meanings.includes("học"));
  }
  assert.deepEqual(await lookup("🙂"), []);
});
test("dictionary failures can be retried instead of caching an error", async () => {
  let calls = 0;
  const lookup = createCharacterDictionary({
    fetcher: async () => {
      if (++calls === 1) throw Error("Offline");
      return {
        ok: true,
        json: async () => ({ 你: [{ pinyin: "ni3", meanings: ["bạn"] }] }),
      };
    },
  });
  await assert.rejects(lookup("你"), /Offline/);
  assert.equal((await lookup("你"))[0].pinyin, "nǐ");
  assert.equal(calls, 2);
});
