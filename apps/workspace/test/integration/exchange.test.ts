import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { decode } from "@msgpack/msgpack";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { Readable } from "node:stream";
import { transformSnapshotToSlideData } from "@univerjs-pro/collaboration";
import { getSlidesEmptySnapshot, PageElementTypeEnum, type ISlideData } from "@univerjs-pro/slides";
import {
  getPdfsEmptySnapshot,
  PdfEditability,
  PdfObjectOrigin,
  PdfObjectType,
  ptToEmu,
  type IPdfTextObject,
  type IPdfUnitData,
} from "@univerjs-pro/pdfs";
import {
  ExchangeFormat,
  exportToBuffer,
  importBuffer,
} from "@univerjs-pro/exchange-node";
import {
  type IWorkbookData,
  ImageSourceType,
  UniverInstanceType,
} from "@univerjs/core";
import { ErrorCode, UniverType } from "@univerjs/protocol";
import { afterEach, describe, expect, it } from "vitest";
import {
  createWorkspaceApplication,
  type WorkspaceApplication,
} from "../../server/src/app.js";
import { blankUnitData } from "../../server/src/integrations/univer/unit-store.js";

const applications: WorkspaceApplication[] = [];
const servers: Server[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
  await Promise.all(
    applications.splice(0).map((application) => application.close())
  );
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Universer Exchange protocol", () => {
  it("exports authorized Workspace images in slides and refuses images the viewer cannot read", async () => {
    const { application, origin } = await startApplication();
    const owner = await register(application, "image-export-owner");
    const viewer = await register(application, "image-export-viewer");
    const space = application.spaces.list(owner.userId).spaces.find(space => space.type === "personal")!;
    const carrier = await application.resources.create(owner.userId, randomUUID(), {
      name: "Image source", spaceId: space.id, parentNodeId: null, kind: "univer", unitType: "slide",
    });
    const resource = carrier.body.node.resource!;
    if (resource.kind !== "univer") throw new Error("Expected Univer Resource");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
    const asset = await application.univerAssets.upload(owner.userId, { kind: "trunk" }, {
      size: png.length, source: 3, assign: resource.unitId, filename: "image.png",
      declaredMediaType: "image/png", body: Readable.from(png),
    });
    const data = getSlidesEmptySnapshot("deck", undefined, "Deck with image");
    const slide = data.slides[data.slideOrder[0]!]!;
    slide.elements.image = { id: "image", type: PageElementTypeEnum.Image, imageSourceType: ImageSourceType.UUID, source: asset.FileId,
      transform: { left: 20, top: 20, width: 100, height: 100, rotation: 0 } };
    slide.elementOrder.push("image");
    const master = data.masterPages![data.masterPageOrder![0]!]!;
    master.elements["master-image"] = { ...slide.elements.image, id: "master-image" };
    master.elementOrder.push("master-image");
    const deck = await application.resources.create(owner.userId, randomUUID(), {
      name: "Deck with image", spaceId: space.id, parentNodeId: null, kind: "univer", unitType: "slide",
      initialData: { ...data },
    });
    const deckResource = deck.body.node.resource!;
    if (deckResource.kind !== "univer") throw new Error("Expected Univer Resource");
    application.permissions.upsertNodeGrant(owner.userId, deck.body.node.id, viewer.userId, { role: "viewer" });
    const start = () => startTask(origin, viewer.cookie, `/universer-api/exchange/${UniverType.UNIVER_SLIDE}/export`, {
      unitID: deckResource.unitId, type: UniverInstanceType.UNIVER_SLIDE, format: ExchangeFormat.PPTX,
    });
    expect(await waitForTask(origin, viewer.cookie, await start())).toMatchObject({ status: "failed" });
    application.permissions.upsertNodeGrant(owner.userId, carrier.body.node.id, viewer.userId, { role: "viewer" });
    const result = await waitForTask(origin, viewer.cookie, await start());
    expect(result, JSON.stringify(result)).toMatchObject({ status: "done", error: { code: ErrorCode.OK } });
    const file = await downloadArtifact(origin, viewer.cookie, result.export!.fileID);
    const imported = await importBuffer(file, { type: UniverInstanceType.UNIVER_SLIDE, fileName: "images.pptx" });
    expect(JSON.stringify(imported)).toContain(png.toString("base64"));
    expect(slide.elements.image.source).toBe(asset.FileId);
    expect(count(application, "univer_assets")).toBe(1);
  }, 20_000);

  it("imports an Office file as a product Resource and exports it for viewers", async () => {
    const { application, origin } = await startApplication();
    const owner = await register(application, "exchange-owner");
    const viewer = await register(application, "exchange-viewer");
    const outsider = await register(application, "exchange-outsider");
    const personalSpace = application.spaces
      .list(owner.userId)
      .spaces.find((space) => space.type === "personal");
    expect(personalSpace).toBeDefined();
    const imports = application.nodes.create(owner.userId, {
      spaceId: personalSpace!.id,
      parentNodeId: null,
      name: "Imports",
    });
    const source = await workbookFile("Revenue", "quarterly-plan");
    const upload = await uploadExchangeFile(origin, owner.cookie, source);

    expect(upload.response.status).toBe(201);
    expect(upload.body.FileId).toEqual(expect.any(String));
    expect(count(application, "univer_assets")).toBe(0);

    const importedTask = await startTask(
      origin,
      owner.cookie,
      "/universer-api/exchange/import",
      {
        fileID: upload.body.FileId,
        outputType: 1,
        spaceId: personalSpace!.id,
        parentNodeId: imports.id,
      }
    );
    const imported = await waitForTask(origin, owner.cookie, importedTask);
    expect(imported.error.code).toBe(ErrorCode.OK);
    expect(imported.status).toBe("done");
    expect(imported.import?.unitID).toEqual(expect.any(String));

    const access = application.access.resolveUnit(
      owner.userId,
      imported.import!.unitID
    );
    expect(access).toMatchObject({
      kind: "univer",
      unitType: "sheet",
      node: {
        name: "quarterly-plan",
        parentNodeId: imports.id,
        spaceType: "personal",
      },
    });
    expect(count(application, "nodes")).toBe(2);
    expect(count(application, "resources")).toBe(1);
    expect(count(application, "univer_resources")).toBe(1);

    await expectTaskStart(
      origin,
      outsider.cookie,
      `/universer-api/exchange/${UniverType.UNIVER_SHEET}/export`,
      {
        unitID: imported.import!.unitID,
        type: UniverInstanceType.UNIVER_SHEET,
        format: ExchangeFormat.XLSX,
      },
      404
    );

    application.permissions.upsertNodeGrant(
      owner.userId,
      access!.node.id,
      viewer.userId,
      { role: "viewer" }
    );
    const exportedTask = await startTask(
      origin,
      viewer.cookie,
      `/universer-api/exchange/${UniverType.UNIVER_SHEET}/export`,
      {
        unitID: imported.import!.unitID,
        type: UniverInstanceType.UNIVER_SHEET,
        format: ExchangeFormat.XLSX,
      }
    );
    const exported = await waitForTask(origin, viewer.cookie, exportedTask);
    expect(exported).toMatchObject({
      error: { code: ErrorCode.OK },
      status: "done",
      export: { fileID: expect.any(String) },
    });

    const hiddenTask = await fetch(
      `${origin}/universer-api/exchange/task/${exportedTask}`,
      { headers: { cookie: outsider.cookie } }
    );
    expect(hiddenTask.status).toBe(200);
    await expect(hiddenTask.json()).resolves.toMatchObject({
      error: { code: ErrorCode.NOT_FOUND },
      status: "failed",
    });
    expect(
      (
        await fetch(
          `${origin}/universer-api/file/${exported.export!.fileID}/sign-url`,
          { headers: { cookie: outsider.cookie } }
        )
      ).status
    ).toBe(404);

    const downloaded = await downloadArtifact(
      origin,
      viewer.cookie,
      exported.export!.fileID
    );
    const workbook = await importBuffer(downloaded, {
      type: UniverInstanceType.UNIVER_SHEET,
      fileName: "exported.xlsx",
    });
    const worksheet = workbook.sheets[workbook.sheetOrder[0]!];
    expect(worksheet?.cellData?.[0]?.[0]?.v).toBe("Revenue");
  }, 20_000);

  it("exports a PDF Unit as a PDF file and imports a PDF file as a PDF Unit", async () => {
    const { application, origin } = await startApplication();
    const owner = await register(application, "pdf-owner");
    const personalSpace = application.spaces
      .list(owner.userId)
      .spaces.find((space) => space.type === "personal");
    expect(personalSpace).toBeDefined();
    const created = await application.resources.create(
      owner.userId,
      randomUUID(),
      {
        kind: "univer",
        spaceId: personalSpace!.id,
        parentNodeId: null,
        name: "Brochure",
        unitType: "pdf",
      }
    );
    if (created.status === 202) throw new Error("PDF Unit creation is pending.");
    const unitId = created.body.node.resource?.unitId;
    expect(unitId).toEqual(expect.any(String));

    const exportedTask = await startTask(
      origin,
      owner.cookie,
      "/universer-api/exchange/7/export",
      { unitID: unitId, format: "pdf" }
    );
    const exported = await waitForTask(origin, owner.cookie, exportedTask);
    expect(exported.error.code).toBe(ErrorCode.OK);
    expect(exported.status).toBe("done");
    const pdf = await downloadArtifact(origin, owner.cookie, exported.export!.fileID);
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");

    const upload = await uploadExchangeFile(
      origin,
      owner.cookie,
      new File([pdf], "brochure.pdf", { type: "application/pdf" })
    );
    expect(upload.response.status).toBe(201);
    const importedTask = await startTask(
      origin,
      owner.cookie,
      "/universer-api/exchange/import",
      { fileID: upload.body.FileId, outputType: 1 }
    );
    const imported = await waitForTask(origin, owner.cookie, importedTask);
    expect(imported.error.code).toBe(ErrorCode.OK);
    expect(imported.status).toBe("done");
    expect(imported.import?.unitID).toEqual(expect.any(String));
    expect(imported.import?.unitID).not.toBe(unitId);
    expect(
      application.access.resolveUnit(owner.userId, imported.import!.unitID)
    ).toMatchObject({
      kind: "univer",
      unitType: "pdf",
      node: { name: "brochure" },
    });

    await expectTaskStart(
      origin,
      owner.cookie,
      "/universer-api/exchange/7/export",
      { unitID: unitId, format: "docx" },
      400
    );
  });

  // SDK 1.4.0 (unchanged since 1.3.1): the PDF editor reducer (`updateObjectPatch`) mirrors
  // every overlay-object edit into `editState.objectPatches` and keeps entries of removed
  // objects; the native exporter reads that map as patches to imported source objects and
  // fails a Unit without a source PDF with "source-less PDF cannot apply imported semantic
  // patches". Workspace keeps the SDK behavior; enable this case with the SDK release that
  // fixes it.
  it.skip("exports a blank PDF Unit after editor edits", async () => {
    const { application, origin } = await startApplication();
    const owner = await register(application, "pdf-editor-owner");
    const unitId = randomUUID();
    const unit = getPdfsEmptySnapshot(unitId, "Notes");
    const page = unit.document.pages[0]!;
    const object: IPdfTextObject = {
      id: `${unitId}:object:text`,
      type: PdfObjectType.TEXT_BOX,
      origin: PdfObjectOrigin.USER_CREATED,
      editability: PdfEditability.SEMANTIC,
      bbox: [ptToEmu(48), ptToEmu(48), ptToEmu(300), ptToEmu(72)],
      runs: [{ text: "Edited note", fontFamily: "Arial", fontSize: 12 }],
    };
    unit.editState.overlayObjects[object.id] = { object, pageId: page.id, zIndex: 0 };
    unit.editState.objectPatches[object.id] = {
      objectId: object.id,
      pageId: page.id,
      bbox: object.bbox,
      text: { range: { start: 0, end: 0 }, text: "Edited note", runs: object.runs },
    };
    unit.editState.objectPatches[`${unitId}:object:removed`] = {
      objectId: `${unitId}:object:removed`,
      pageId: page.id,
      bbox: [0, 0, ptToEmu(10), ptToEmu(10)],
    };
    const snapshotJson = JSON.stringify({
      snapshot: {
        unitID: unitId,
        rev: 1,
        type: UniverType.UNIVER_PDF,
        pdf: {
          unitID: unitId,
          rev: 1,
          creator: "",
          name: "Notes",
          pdfModelSchema: "univer-pdf-unit",
          pdfModelSchemaVersion: 1,
          originalMeta: Buffer.from(JSON.stringify(unit)).toString("base64"),
        },
      },
      sheetBlocks: {},
    });
    const upload = await uploadExchangeFile(
      origin,
      owner.cookie,
      new File([snapshotJson], "notes.json", { type: "application/json" })
    );
    expect(upload.response.status).toBe(201);

    const exportedTask = await startTask(
      origin,
      owner.cookie,
      "/universer-api/exchange/7/export",
      { jsonID: upload.body.FileId, format: "pdf" }
    );
    const exported = await waitForTask(origin, owner.cookie, exportedTask);
    expect(exported.error.code).toBe(ErrorCode.OK);
    expect(exported.status).toBe("done");
    const pdf = await downloadArtifact(origin, owner.cookie, exported.export!.fileID);
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    const reimported = (await importBuffer(pdf, {
      type: UniverInstanceType.UNIVER_PDF,
      format: ExchangeFormat.PDF,
      fileName: "notes.pdf",
    } as never)) as unknown as IPdfUnitData;
    expect(JSON.stringify(reimported.document)).toContain("Edited note");
  }, 20_000);

  it("round-trips the client JSON snapshot flow", async () => {
    const { application, origin } = await startApplication();
    const owner = await register(application, "exchange-json-owner");
    const source = await workbookFile("JSON round trip", "snapshot-source");
    const uploaded = await uploadExchangeFile(origin, owner.cookie, source);
    const importedTask = await startTask(
      origin,
      owner.cookie,
      `/universer-api/exchange/${UniverType.UNIVER_SHEET}/import`,
      { fileID: uploaded.body.FileId, outputType: 2 }
    );
    const imported = await waitForTask(origin, owner.cookie, importedTask);
    expect(imported).toMatchObject({
      error: { code: ErrorCode.OK },
      status: "done",
      import: { outputType: 2, jsonID: expect.any(String) },
    });
    expect(count(application, "resources")).toBe(0);

    const snapshotBuffer = await downloadArtifact(
      origin,
      owner.cookie,
      imported.import!.jsonID
    );
    const snapshotJson = JSON.parse(snapshotBuffer.toString("utf8")) as {
      readonly snapshot: { readonly workbook?: { readonly originalMeta?: unknown } };
      readonly sheetBlocks: Readonly<Record<string, { readonly data?: unknown }>>;
    };
    expect(snapshotJson.snapshot.workbook?.originalMeta).toEqual(
      expect.any(String)
    );
    expect(Object.values(snapshotJson.sheetBlocks)[0]?.data).toEqual(
      expect.any(String)
    );

    const compressed = deflateRawSync(snapshotBuffer);
    const compressedUpload = await uploadExchangeFile(
      origin,
      owner.cookie,
      new File([compressed], "snapshot.json", {
        type: "application/json",
      }),
      { declaredSize: snapshotBuffer.byteLength, flate: true }
    );
    expect(compressedUpload.response.status).toBe(201);

    const exportedTask = await startTask(
      origin,
      owner.cookie,
      `/universer-api/exchange/${UniverType.UNIVER_SHEET}/export`,
      {
        jsonID: compressedUpload.body.FileId,
        type: UniverInstanceType.UNIVER_SHEET,
        format: ExchangeFormat.XLSX,
      }
    );
    const exported = await waitForTask(origin, owner.cookie, exportedTask);
    const workbook = await importBuffer(
      await downloadArtifact(
        origin,
        owner.cookie,
        exported.export!.fileID
      ),
      {
        type: UniverInstanceType.UNIVER_SHEET,
        fileName: "round-trip.xlsx",
      }
    );
    const worksheet = workbook.sheets[workbook.sheetOrder[0]!];
    expect(worksheet?.cellData?.[0]?.[0]?.v).toBe("JSON round trip");
  }, 20_000);

  it.each([
    {
      unitType: "doc" as const,
      protocolType: UniverType.UNIVER_DOC,
      instanceType: UniverInstanceType.UNIVER_DOC,
      format: ExchangeFormat.DOCX,
    },
    {
      unitType: "slide" as const,
      protocolType: UniverType.UNIVER_SLIDE,
      instanceType: UniverInstanceType.UNIVER_SLIDE,
      format: ExchangeFormat.PPTX,
    },
    {
      unitType: "base" as const,
      protocolType: UniverType.UNIVER_BASE,
      instanceType: UniverInstanceType.UNIVER_BASE,
      format: ExchangeFormat.XLSX,
    },
  ])("imports and exports $unitType Office content", async (fixture) => {
    const { application, origin } = await startApplication();
    const owner = await register(
      application,
      `exchange-${fixture.unitType}-owner`
    );
    const source = await officeFile(fixture);
    const uploaded = await uploadExchangeFile(origin, owner.cookie, source);
    const taskId = await startTask(
      origin,
      owner.cookie,
      `/universer-api/exchange/${fixture.protocolType}/import`,
      { fileID: uploaded.body.FileId, outputType: 1 }
    );
    const imported = await waitForTask(origin, owner.cookie, taskId);
    expect(imported).toMatchObject({
      error: { code: ErrorCode.OK },
      status: "done",
      import: { unitID: expect.any(String) },
    });
    expect(
      application.access.resolveUnit(owner.userId, imported.import!.unitID)
    ).toMatchObject({
      kind: "univer",
      unitType: fixture.unitType,
    });
    const exportTask = await startTask(
      origin, owner.cookie, `/universer-api/exchange/${fixture.protocolType}/export`,
      { unitID: imported.import!.unitID, type: fixture.instanceType, format: fixture.format }
    );
    const exported = await waitForTask(origin, owner.cookie, exportTask);
    expect(exported, JSON.stringify(exported)).toMatchObject({ status: "done", error: { code: ErrorCode.OK } });
    const bytes = await downloadArtifact(origin, owner.cookie, exported.export!.fileID);
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
  });

  it("stores imported images and attachments as Trunk Assets of the new Unit", async () => {
    const { application, origin } = await startApplication();
    const owner = await register(application, "ole-import-owner");
    const uploaded = await uploadExchangeFile(origin, owner.cookie, await oleFixture());
    const imported = await waitForTask(
      origin,
      owner.cookie,
      await startTask(origin, owner.cookie, `/universer-api/exchange/${UniverType.UNIVER_SLIDE}/import`, {
        fileID: uploaded.body.FileId,
        outputType: 1,
      })
    );
    expect(imported, JSON.stringify(imported)).toMatchObject({ status: "done", error: { code: ErrorCode.OK } });
    const unitId = imported.import!.unitID;

    const assets = listAssets(application);
    expect(assets.length).toBeGreaterThan(0);
    expect(assets.every((asset) => asset.unit_id === unitId && asset.worktree_id === null)).toBe(true);
    expect(assets.some((asset) => asset.original_filename.endsWith(".docx"))).toBe(true);
    expect(count(application, "univer_asset_uploads")).toBe(0);
    // The stored snapshot keeps Asset IDs, never the bytes.
    const serialized = JSON.stringify(storedSlideData(unitId));
    for (const asset of assets) expect(serialized).toContain(asset.id);
    expect(Buffer.byteLength(serialized)).toBeLessThan(200_000);

    // Exporting loads the stored files back through exchange-node.
    const exported = await waitForTask(
      origin,
      owner.cookie,
      await startTask(origin, owner.cookie, `/universer-api/exchange/${UniverType.UNIVER_SLIDE}/export`, {
        unitID: unitId, type: UniverInstanceType.UNIVER_SLIDE, format: ExchangeFormat.PPTX,
      })
    );
    expect(exported, JSON.stringify(exported)).toMatchObject({ status: "done", error: { code: ErrorCode.OK } });
    const bytes = await downloadArtifact(origin, owner.cookie, exported.export!.fileID);
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
  }, 60_000);

  it("converts a stored attachment into an online document next to its host and embeds it on export", async () => {
    const { application, origin } = await startApplication();
    const owner = await register(application, "ole-convert-owner");
    const viewer = await register(application, "ole-convert-viewer");
    const outsider = await register(application, "ole-convert-outsider");
    const personalSpace = application.spaces.list(owner.userId).spaces.find((space) => space.type === "personal")!;
    const folder = application.nodes.create(owner.userId, { spaceId: personalSpace.id, parentNodeId: null, name: "Decks" });
    const uploaded = await uploadExchangeFile(origin, owner.cookie, await oleFixture());
    const imported = await waitForTask(
      origin,
      owner.cookie,
      await startTask(origin, owner.cookie, `/universer-api/exchange/${UniverType.UNIVER_SLIDE}/import`, {
        fileID: uploaded.body.FileId, outputType: 1, spaceId: personalSpace.id, parentNodeId: folder.id,
      })
    );
    expect(imported).toMatchObject({ status: "done" });
    const hostUnitId = imported.import!.unitID;
    const hostNode = application.access.resolveUnit(owner.userId, hostUnitId)!.node;
    const attachment = listAssets(application).find((asset) => asset.original_filename.endsWith(".docx"))!;
    expect(attachment).toBeDefined();
    const convertPath = `/universer-api/exchange/${UniverType.UNIVER_DOC}/import`;
    const convertBody = { fileID: attachment.id, outputType: 1, sourceUnitID: hostUnitId };

    // Only a caller who can open the host may convert, and only the host's own attachments.
    await expectTaskStart(origin, outsider.cookie, convertPath, convertBody, 404);
    await expectTaskStart(origin, owner.cookie, convertPath, { ...convertBody, sourceUnitID: randomUUID() }, 404);
    await expectTaskStart(origin, owner.cookie, convertPath, { ...convertBody, outputType: 2 }, 400);

    const converted = await waitForTask(origin, owner.cookie, await startTask(origin, owner.cookie, convertPath, convertBody));
    expect(converted, JSON.stringify(converted)).toMatchObject({ status: "done", error: { code: ErrorCode.OK } });
    const childUnitId = converted.import!.unitID;
    const child = application.access.resolveUnit(owner.userId, childUnitId)!;
    expect(child).toMatchObject({ kind: "univer", unitType: "doc" });
    // The online document lands in the host's folder; the attachment stays with the host.
    expect(child.node.parentNodeId).toBe(hostNode.parentNodeId);
    expect(child.node.spaceId).toBe(hostNode.spaceId);
    await expect(application.univerAssets.openContent(owner.userId, { kind: "trunk" }, attachment.id, undefined))
      .resolves.toMatchObject({ asset: { unit_id: hostUnitId } });

    // The client records the conversion on the host drawing as `oleOnlineUnit`; this host deck
    // carries that link so the online export has a child document to embed.
    const hostSlide = storedSlideData(hostUnitId);
    const oleElements = Object.values(hostSlide.slides)
      .flatMap((page) => Object.values(page.elements))
      .filter((element) => element.type === PageElementTypeEnum.Ole);
    expect(oleElements).toHaveLength(1);
    Object.assign(oleElements[0]!, { oleOnlineUnit: { unitId: childUnitId, type: UniverInstanceType.UNIVER_DOC } });
    const linkedDeck = await application.resources.create(owner.userId, randomUUID(), {
      name: "Linked deck", spaceId: personalSpace.id, parentNodeId: folder.id, kind: "univer", unitType: "slide",
      initialData: { ...hostSlide },
    });
    const linkedUnitId = (linkedDeck.body.node.resource as { readonly unitId: string }).unitId;

    // Exports that take files embed the online version by default; the others cannot ask for it.
    application.permissions.upsertNodeGrant(owner.userId, hostNode.id, viewer.userId, { role: "viewer" });
    application.permissions.upsertNodeGrant(owner.userId, linkedDeck.body.node.id, viewer.userId, { role: "viewer" });
    const exportPath = `/universer-api/exchange/${UniverType.UNIVER_SLIDE}/export`;
    const byDefault = { unitID: linkedUnitId, type: UniverInstanceType.UNIVER_SLIDE, format: ExchangeFormat.PPTX };
    await expectTaskStart(origin, owner.cookie, `/universer-api/exchange/${UniverType.UNIVER_SHEET}/export`, {
      unitID: linkedUnitId, type: UniverInstanceType.UNIVER_SHEET, format: ExchangeFormat.CSV, options: { oleAttachmentSource: "online", sheet: { csv: { sheetId: "x" } } },
    }, 400);
    await expectTaskStart(origin, owner.cookie, exportPath, { ...byDefault, options: { oleAttachmentSource: "latest" } }, 400);

    // A reader of the host who cannot open the converted document cannot export the host either,
    // unless the request asks for the original attachment files.
    const viewerDefault = await waitForTask(origin, viewer.cookie, await startTask(origin, viewer.cookie, exportPath, byDefault));
    expect(viewerDefault).toMatchObject({ status: "failed" });
    const viewerOriginal = await waitForTask(origin, viewer.cookie, await startTask(origin, viewer.cookie, exportPath, { ...byDefault, options: { oleAttachmentSource: "original" } }));
    expect(viewerOriginal, JSON.stringify(viewerOriginal)).toMatchObject({ status: "done" });

    const ownerDefault = await waitForTask(origin, owner.cookie, await startTask(origin, owner.cookie, exportPath, byDefault));
    expect(ownerDefault, JSON.stringify(ownerDefault)).toMatchObject({ status: "done", error: { code: ErrorCode.OK } });
    const bytes = await downloadArtifact(origin, owner.cookie, ownerDefault.export!.fileID);
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
  }, 90_000);

  it("preserves a UTF-8 filename when importing Office content", async () => {
    const { application, origin } = await startApplication();
    const owner = await register(application, "exchange-utf8-filename-owner");
    const generated = await officeFile({
      unitType: "slide",
      instanceType: UniverInstanceType.UNIVER_SLIDE,
      format: ExchangeFormat.PPTX,
    });
    const source = new File([await generated.arrayBuffer()], "AI转型.pptx", {
      type: generated.type,
    });
    const uploaded = await uploadExchangeFile(origin, owner.cookie, source);
    const taskId = await startTask(
      origin,
      owner.cookie,
      "/universer-api/exchange/import",
      { fileID: uploaded.body.FileId, outputType: 1 }
    );
    const imported = await waitForTask(origin, owner.cookie, taskId);

    expect(imported).toMatchObject({
      error: { code: ErrorCode.OK },
      status: "done",
      import: { unitID: expect.any(String) },
    });
    expect(
      application.access.resolveUnit(owner.userId, imported.import!.unitID)
    ).toMatchObject({
      kind: "univer",
      unitType: "slide",
      node: { name: "AI转型" },
    });
  }, 20_000);
});

async function startApplication(): Promise<{
  readonly application: WorkspaceApplication;
  readonly origin: string;
}> {
  const directory = mkdtempSync(join(tmpdir(), "workspace-exchange-"));
  directories.push(directory);
  const application = createWorkspaceApplication({
    host: "127.0.0.1",
    port: 0,
    databaseFilename: join(directory, "product.sqlite"),
    collaborationDatabaseFilename: join(directory, "collaboration.sqlite"),
    blobDirectory: join(directory, "objects"),
    secureCookies: false,
    sessionTtlMs: 60_000,
  });
  applications.push(application);
  const server = createServer(application.app);
  servers.push(server);
  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server address is missing.");
  }
  return {
    application,
    origin: `http://127.0.0.1:${address.port}`,
  };
}

async function register(
  application: WorkspaceApplication,
  username: string
): Promise<{ readonly userId: string; readonly cookie: string }> {
  const issued = await application.identity.registerWithPassword({
    username,
    displayName: username,
    password: "correct horse battery staple",
  });
  return {
    userId: issued.view.user.id,
    cookie: `${application.identity.cookieName}=${issued.cookieValue}`,
  };
}

async function workbookFile(value: string, name: string): Promise<File> {
  const created = blankUnitData({
    unitId: randomUUID(),
    unitType: "sheet",
    name,
  });
  const workbook = created.data as IWorkbookData;
  const worksheet = workbook.sheets[workbook.sheetOrder[0]!];
  if (!worksheet) throw new Error("Fixture worksheet is missing.");
  worksheet.cellData = { 0: { 0: { v: value } } };
  const output = await exportToBuffer(workbook, {
    type: UniverInstanceType.UNIVER_SHEET,
    format: ExchangeFormat.XLSX,
  });
  return new File([output], `${name}.xlsx`, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

async function officeFile(fixture: {
  readonly unitType: "doc" | "slide" | "base";
  readonly instanceType: UniverInstanceType;
  readonly format: ExchangeFormat;
}): Promise<File> {
  const created = blankUnitData({
    unitId: randomUUID(),
    unitType: fixture.unitType,
    name: `Imported ${fixture.unitType}`,
  });
  const convert = exportToBuffer as unknown as (
    data: unknown,
    options: {
      readonly type: UniverInstanceType;
      readonly format: ExchangeFormat;
    }
  ) => Promise<Buffer>;
  const output = await convert(created.data, {
    type: fixture.instanceType,
    format: fixture.format,
  });
  return new File([output], `import.${fixture.format}`);
}

async function oleFixture(): Promise<File> {
  // A Slide with an embedded Office attachment and pictures; see test/fixtures/office/README.md.
  const bytes = await readFile(new URL("../fixtures/office/nested-ole.pptx", import.meta.url));
  return new File([bytes], "nested-ole.pptx", {
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
}

/** The Slide data of the Unit's stored snapshot (Core v3 MessagePack in the collaboration database). */
function storedSlideData(unitId: string): ISlideData {
  const database = new DatabaseSync(join(directories.at(-1)!, "collaboration.sqlite"), { readOnly: true });
  try {
    const row = database
      .prepare("SELECT payload FROM collaboration_snapshots WHERE unit_id = ? ORDER BY revision DESC LIMIT 1")
      .get(unitId) as { readonly payload: Uint8Array } | undefined;
    if (!row) throw new Error("The imported Unit has no stored snapshot.");
    return transformSnapshotToSlideData(decode(row.payload) as never);
  } finally {
    database.close();
  }
}

function listAssets(application: WorkspaceApplication): readonly {
  readonly id: string;
  readonly unit_id: string;
  readonly worktree_id: string | null;
  readonly original_filename: string;
  readonly media_type: string;
}[] {
  return application.database.connection
    .prepare("SELECT id, unit_id, worktree_id, original_filename, media_type FROM univer_assets ORDER BY created_at, id")
    .all() as never;
}

async function uploadExchangeFile(
  origin: string,
  cookie: string,
  file: File,
  options: {
    readonly declaredSize?: number;
    readonly flate?: boolean;
  } = {}
): Promise<{
  readonly response: Response;
  readonly body: { readonly FileId: string };
}> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(
    `${origin}/universer-api/stream/file/upload?size=${options.declaredSize ?? file.size}&source=1&flate=${options.flate ?? false}`,
    { method: "POST", headers: { cookie }, body: form }
  );
  return {
    response,
    body: (await response.json()) as { readonly FileId: string },
  };
}

async function startTask(
  origin: string,
  cookie: string,
  path: string,
  body: unknown
): Promise<string> {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  const result = (await response.json()) as { readonly taskID?: string };
  expect(result.taskID).toEqual(expect.any(String));
  return result.taskID!;
}

async function expectTaskStart(
  origin: string,
  cookie: string,
  path: string,
  body: unknown,
  expectedStatus: number
): Promise<void> {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(expectedStatus);
}

interface TaskResponse {
  readonly error: { readonly code: number; readonly message: string };
  readonly status: string;
  readonly import?: {
    readonly outputType: number;
    readonly unitID: string;
    readonly jsonID: string;
  };
  readonly export?: { readonly fileID: string; readonly fileUrl: string };
}

async function waitForTask(
  origin: string,
  cookie: string,
  taskId: string
): Promise<TaskResponse> {
  // The first export in a process boots the runtime worker pool.
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const response = await fetch(
      `${origin}/universer-api/exchange/task/${taskId}`,
      { headers: { cookie } }
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as TaskResponse;
    if (body.status !== "pending") return body;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Exchange task ${taskId} did not finish.`);
}

async function downloadArtifact(
  origin: string,
  cookie: string,
  fileId: string
): Promise<Buffer> {
  const signed = await fetch(
    `${origin}/universer-api/file/${fileId}/sign-url`,
    { headers: { cookie } }
  );
  expect(signed.status).toBe(200);
  const body = (await signed.json()) as { readonly url: string };
  const content = await fetch(`${origin}${body.url}`, {
    headers: { cookie },
  });
  expect(content.status).toBe(200);
  return Buffer.from(await content.arrayBuffer());
}

function count(application: WorkspaceApplication, table: string): number {
  return (
    application.database.connection
      .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
      .get() as { readonly count: number }
  ).count;
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
