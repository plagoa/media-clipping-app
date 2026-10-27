import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeResults } from "./mergeResults.js";

test("deduplicates headlines for the same publisher while preserving result order", () => {
  const first = {
    id: "first",
    sourceId: "googleNews",
    publisherName: "Expresso",
    title: "A notícia",
  };
  const duplicate = {
    id: "duplicate",
    sourceId: "googleNews",
    publisherName: "Expresso",
    title: " A NOTÍCIA ",
  };
  const other = {
    id: "other",
    sourceId: "googleNews",
    publisherName: "Outro jornal",
    title: "A notícia",
  };
  const unique = {
    id: "unique",
    sourceId: "googleNews",
    publisherName: "Novo Jornal",
    title: "Outro título",
  };
  assert.deepEqual(
    mergeResults([first, duplicate, other, unique]).map(({ id }) => id),
    ["first", "other", "unique"],
  );
});

test("does not collapse unknown publishers with the same headline", () => {
  const unknown = ["1", "2"].map((id) => ({
    id,
    sourceId: "googleNews",
    publisherName: "Unknown publisher",
    title: "Notícia",
  }));
  assert.equal(mergeResults(unknown).length, 2);
});
