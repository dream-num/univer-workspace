import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LICENSE_TARGETS,
  describeLicense,
  parseLicenseUpdateArgs,
  renderLicenseModule,
} from "./update-univer-license.mjs";

const payload = { i: "1", dm: ["localhost", "app"], at: 1793621959, ud: 1801580400 };
const license = `1-1-${Buffer.from(JSON.stringify(payload)).toString("base64")}-c2lnbmF0dXJl-1793621959`;

test("parses both credential paths", () => {
  assert.deepEqual(parseLicenseUpdateArgs(["--license", "a.txt", "--license-key=b.txt"]), {
    license: "a.txt",
    licenseKey: "b.txt",
  });
  assert.throws(() => parseLicenseUpdateArgs(["--license", "a.txt"]), /--license-key/u);
  assert.throws(() => parseLicenseUpdateArgs(["--key", "a.txt"]), /--license-key/u);
});

test("reads issue time, expiry and domains from the signed payload", () => {
  assert.deepEqual(describeLicense(license, "c2VjcmV0"), {
    issuedAt: "2026-11-02T12:19:19Z",
    expiresAt: "2027-02-02T15:00:00Z",
    domains: ["localhost", "app"],
  });
  assert.throws(() => describeLicense("not-a-license", "c2VjcmV0"), /Univer license/u);
  assert.throws(() => describeLicense(license, "has spaces"), /license key/u);
});

test("renders every constant a target declares", () => {
  const details = describeLicense(license, "c2VjcmV0");
  const rendered = LICENSE_TARGETS.map((target) =>
    renderLicenseModule(target, { license, licenseKey: "c2VjcmV0" }, details),
  );
  assert.equal(rendered.length, 5);
  assert.doesNotMatch(rendered[0], /c2VjcmV0/u);
  for (const source of rendered.slice(1)) assert.match(source, /"c2VjcmV0"/u);
  for (const source of rendered) {
    assert.match(source, /Issued 2026-11-02T12:19:19Z; expires 2027-02-02T15:00:00Z/u);
    assert.ok(source.includes(JSON.stringify(license)));
  }
});
