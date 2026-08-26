import { describe, expect, it } from "vitest";
import * as host from "../src/index.js";
import { createClientPlugin } from "../src/client/plugin.js";

describe("dsh-univer-workspace-skin-plugin shell", () => {
  it("exports a loadable cordis host plugin", () => {
    expect(host.name).toBe("dsh-univer-workspace-skin-plugin");
    expect(typeof host.apply).toBe("function");
  });

  it("exports a client plugin factory", () => {
    const client = createClientPlugin();
    expect(typeof client.apply).toBe("function");
  });
});
