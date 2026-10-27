import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatPublicationDate,
  publicationDay,
  sortAndFilterResults,
} from "./resultDates.js";

const results = [
  {
    id: "old-expresso",
    sourceId: "expresso",
    publishedAt: "2026-10-25T10:00:00Z",
  },
  { id: "undated", sourceId: "publico", publishedAt: null },
  {
    id: "earlier-publico",
    sourceId: "publico",
    publishedAt: "2026-10-27T09:00:00Z",
  },
  {
    id: "later-expresso",
    sourceId: "expresso",
    publishedAt: "2026-10-27T15:00:00Z",
  },
  { id: "date-only", sourceId: "publico", publishedAt: "2026-10-27" },
  { id: "invalid", sourceId: "expresso", publishedAt: "not a date" },
];

test("formats publication time in Lisbon without inventing time for date-only values", () => {
  assert.equal(
    formatPublicationDate("2026-01-01T23:30:00Z"),
    "1 Jan 2026, 23:30",
  );
  assert.equal(
    formatPublicationDate("2026-06-01T23:30:00Z"),
    "2 Jun 2026, 00:30",
  );
  assert.equal(formatPublicationDate("2026-06-01"), "1 Jun 2026");
});

test("merges sources in descending date order without mutating results", () => {
  const sorted = sortAndFilterResults(results);
  assert.deepEqual(
    sorted.map(({ id }) => id),
    [
      "later-expresso",
      "earlier-publico",
      "date-only",
      "old-expresso",
      "undated",
      "invalid",
    ],
  );
  assert.equal(results[0].id, "old-expresso");
});

test("today filter excludes other days and unknown dates", () => {
  const sorted = sortAndFilterResults(
    results,
    true,
    new Date("2026-10-27T20:00:00Z"),
  );
  assert.deepEqual(
    sorted.map(({ id }) => id),
    ["later-expresso", "earlier-publico", "date-only"],
  );
});

test("today uses Lisbon calendar dates across midnight and daylight saving", () => {
  assert.equal(publicationDay("2026-06-01T23:30:00Z"), "2026-06-02");
  assert.equal(publicationDay("2026-01-01T23:30:00Z"), "2026-01-01");
  const boundary = [
    { id: "previous", publishedAt: "2026-06-01T22:30:00Z" },
    { id: "today", publishedAt: "2026-06-01T23:30:00Z" },
    { id: "date-only", publishedAt: "2026-06-02" },
  ];
  assert.deepEqual(
    sortAndFilterResults(boundary, true, new Date("2026-06-01T23:45:00Z")).map(
      ({ id }) => id,
    ),
    ["today", "date-only"],
  );
});
