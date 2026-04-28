const targetUrl = (process.env.TARGET_URL || "http://127.0.0.1:8787").replace(
  /\/$/,
  "",
);
const expectedRevision = String(process.env.EXPECTED_REVISION || "").trim();
const expectedVersion = String(process.env.EXPECTED_VERSION || "").trim();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const healthResponse = await fetch(`${targetUrl}/health`, {
    headers: { Accept: "application/json" },
  });
  assert(healthResponse.ok, `/health returned ${healthResponse.status}`);
  const health = await healthResponse.json();
  assert(health.ok === true, "health ok=false");
  assert(health.app === "BlockDrop", `unexpected app ${health.app}`);
  assert(
    health.service === "blockdrop-web-game",
    `unexpected service ${health.service}`,
  );
  if (expectedRevision) {
    assert(
      health.revision === expectedRevision,
      `revision ${health.revision} !== ${expectedRevision}`,
    );
  }
  if (expectedVersion) {
    assert(
      health.version === expectedVersion,
      `version ${health.version} !== ${expectedVersion}`,
    );
  }

  const metricsResponse = await fetch(`${targetUrl}/metrics`, {
    headers: { Accept: "text/plain" },
  });
  assert(metricsResponse.ok, `/metrics returned ${metricsResponse.status}`);
  const metricsText = await metricsResponse.text();
  assert(
    metricsText.includes("blockdrop_rooms_active"),
    "metrics payload missing blockdrop_rooms_active",
  );
  assert(
    metricsText.includes("blockdrop_records_total"),
    "metrics payload missing blockdrop_records_total",
  );

  console.log(
    JSON.stringify(
      {
        targetUrl,
        revision: health.revision,
        version: health.version,
        metricsChecked: true,
      },
      null,
      2,
    ),
  );
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
