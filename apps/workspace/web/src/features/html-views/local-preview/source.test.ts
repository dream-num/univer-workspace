import { expect, it } from "vitest";
import { parsePreviewSearch } from "./source";

const token = "t0123456789abcdef0123456789abcdef";
const valid = { src: "http://127.0.0.1:41234/page", token };

it("accepts a loopback HTTP source with an explicit port and a token", () => {
  expect(parsePreviewSearch({ ...valid, file: "page.univer.html" })).toEqual({ src: "http://127.0.0.1:41234/page", token, file: "page.univer.html" });
  expect(parsePreviewSearch({ src: "http://localhost:3000/page", token })).toMatchObject({ src: "http://localhost:3000/page" });
});

it("refuses anything that is not plain loopback HTTP with a port", () => {
  for (const src of [
    "https://127.0.0.1:41234/page", "http://127.0.0.1/page", "http://127.0.0.1:0/page", "http://127.0.0.1:70000/page",
    "http://example.com:41234/page", "http://127.0.0.1.example.com:41234/page", "http://user:pw@127.0.0.1:41234/page",
    "http://127.0.0.1:41234@evil.example/page", "http://[::1]:41234/page", "http://127.0.0.1:41234/page?x=1", "//127.0.0.1:41234/page", 41234,
  ]) expect(() => parsePreviewSearch({ src, token }), String(src)).toThrow();
});

it("requires a well-formed token with a source, and no token without one", () => {
  expect(() => parsePreviewSearch({ src: valid.src })).toThrow(/token/);
  expect(() => parsePreviewSearch({ ...valid, token: "short" })).toThrow(/token/);
  expect(() => parsePreviewSearch({ ...valid, token: 123456789012345678 })).toThrow(/token/);
  expect(() => parsePreviewSearch({ token })).toThrow(/src/);
  expect(parsePreviewSearch({})).toEqual({});
});

it("takes repo and pr together or not at all", () => {
  expect(parsePreviewSearch({ repo: "acme/data", pr: "3" })).toEqual({ repo: "acme/data", pr: 3 });
  for (const search of [{ repo: "acme/data" }, { pr: 3 }, { repo: "acme", pr: 3 }, { repo: "acme/data", pr: 0 }, { repo: "acme/data", pr: 1.5 }])
    expect(() => parsePreviewSearch(search)).toThrow();
});
