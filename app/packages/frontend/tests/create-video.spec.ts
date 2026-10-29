import { test, expect } from "@playwright/test";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const WEBM = Buffer.from(
  [
    "GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAKwEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZU",
    "rmtTrIHWTbuMU6uEElTDZ1OsggEjTbuMU6uEHFO7a1OsggKa7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxM",
    "YXZmNjIuMy4xMDBXQYxMYXZmNjIuMy4xMDBEiYhAiQAAAAAAABZUrmvIrgEAAAAAAAA/14EBc8WITbpgpVc+sqKcgQAitZyDdW5k",
    "iIEAhoVWX1ZQOIOBASPjg4QF9eEA4JCwgUC6gUCagQJVsIRVuYEBElTDZ/tzc59jwIBnyJlFo4dFTkNPREVSRIeMTGF2ZjYyLjMu",
    "MTAwc3PWY8CLY8WITbpgpVc+sqJnyKFFo4dFTkNPREVSRIeUTGF2YzYyLjExLjEwMCBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAw",
    "OjAwOjAwLjgwMDAwMDAwMAAfQ7Z1QPHngQCjxIEAAIDQAwCdASpAAEAAAEcIhYWIhYSIAgICdaoD+AP6AgcaRkYBcMdIS8QA/v1u",
    "8//jmTcwxP+Obf/xYTwOKMj/8VEAo5aBAGQA0QEAARAQABgAGFgv9AAIjoAAo5aBAMgA0QEAARAQABgAGFgv9AAIjoAAo5aBASwA",
    "0QEAARAQABgAGFgv9AAIjoAAo5aBAZAA0QEAARAQABgAGFgv9AAIjoAAo5aBAfQA0QEAARAQABgAGFgv9AAIjoAAo5aBAlgA0QEA",
    "ARAQABgAGFgv9AAIjoAAo5aBArwA0QEAARAQFGAAYWC/0AAiOgAAHFO7a5G7j7OBALeK94EB8YIBo/CBAw==",
  ].join(""),
  "base64",
);

test("rejected file and unsupported decoder preserve manual image and never upload", async ({
  page,
}) => {
  const remote: string[] = [];
  page.on("request", (request) => {
    if (
      /^https?:/.test(request.url()) &&
      new URL(request.url()).hostname !== "127.0.0.1"
    )
      remote.push(request.url());
  });
  await page.goto("/create");
  const videoField = page.getByRole("group", { name: /^Video and cover/ });
  await page
    .getByLabel(/^Coin image/)
    .setInputFiles({ name: "manual.png", mimeType: "image/png", buffer: PNG });
  const video = page.getByLabel("Local video", { exact: true });
  await video.setInputFiles({
    name: "empty.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.alloc(0),
  });
  await expect(videoField.getByRole("alert")).toContainText("non-empty video");
  await expect(page.getByTestId("selected-image")).toContainText("manual.png");
  await video.setInputFiles({
    name: "invalid.webm",
    mimeType: "video/webm",
    buffer: Buffer.from("not a video"),
  });
  await expect(videoField.getByRole("alert")).toContainText("could not decode");
  await expect(page.getByTestId("selected-image")).toContainText("manual.png");
  await expect(
    page.getByRole("button", {
      name: "Launch unavailable in local reconstruction",
    }),
  ).toBeDisabled();
  expect(remote).toEqual([]);
});

test("manual replacement and reset cancel a pending decode rather than publishing stale covers", async ({
  page,
}) => {
  // Deliberately stalled decoder for lifecycle controls, not a real-codec success claim.
  await page.addInitScript(() => {
    // Setting src starts native resource selection even when load() is a no-op.
    // Keep this test's decoder pending before it can reject synthetic bytes.
    const src = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      "src",
    )!;
    Object.defineProperty(HTMLVideoElement.prototype, "src", {
      ...src,
      set() {},
    });
    HTMLVideoElement.prototype.load = function () {};
  });
  await page.goto("/create");
  const videoField = page.getByRole("group", { name: /^Video and cover/ });
  const video = page.getByLabel("Local video", { exact: true });
  await video.setInputFiles({
    name: "pending.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("synthetic"),
  });
  await expect(videoField.getByRole("status")).toContainText(
    "Preparing local video covers",
  );
  await page.getByLabel(/^Coin image/).setInputFiles({
    name: "new-manual.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(
    page.getByText("Preparing local video covers…", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByTestId("selected-image")).toContainText(
    "new-manual.png",
  );
  await video.setInputFiles({
    name: "pending-again.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("synthetic"),
  });
  await expect(videoField.getByRole("status")).toContainText(
    "Preparing local video covers",
  );
  await page.getByRole("button", { name: "Reset draft", exact: true }).click();
  await expect(page.getByTestId("selected-image")).toHaveCount(0);
  await expect(
    page.getByText("Preparing local video covers…", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("group", { name: "Video cover choices" }),
  ).toHaveCount(0);
});

test("manual image replacement detaches the previously selected video cover", async ({
  page,
}) => {
  await page.goto("/create");
  const videoField = page.getByRole("group", { name: /^Video and cover/ });
  await page.getByLabel("Local video", { exact: true }).setInputFiles({
    name: "sample.webm",
    mimeType: "video/webm",
    buffer: WEBM,
  });
  const covers = videoField.getByRole("group", {
    name: "Video cover choices",
  });
  const firstCover = covers.getByRole("button", { name: /Cover 1/ });
  await expect(firstCover).toHaveAttribute("aria-pressed", "true", {
    timeout: 15_000,
  });
  await page.getByLabel(/^Coin image/).setInputFiles({
    name: "manual.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(page.getByTestId("selected-image")).toContainText("manual.png");
  await expect(firstCover).toHaveAttribute("aria-pressed", "false");
  const secondCover = covers.getByRole("button", { name: /Cover 2/ });
  await secondCover.click();
  await expect(secondCover).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("selected-image")).toContainText(
    "video-cover-2.jpg",
  );
  await page.getByRole("button", { name: "Remove image", exact: true }).click();
  await expect(page.getByTestId("selected-image")).toHaveCount(0);
  await expect(secondCover).toHaveAttribute("aria-pressed", "false");
  await expect(
    videoField.getByLabel("Local draft video preview"),
  ).toBeVisible();
});
