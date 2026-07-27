const targetUrl = (process.env.TARGET_URL || "http://127.0.0.1:8787").replace(
  /\/$/,
  "",
);
const expectedRevision = String(process.env.EXPECTED_REVISION || "").trim();
const expectedVersion = String(process.env.EXPECTED_VERSION || "").trim();
const metricsToken = String(process.env.METRICS_TOKEN || "").trim();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const liveResponse = await fetch(`${targetUrl}/health/live`, {
    headers: { Accept: "application/json" },
  });
  assert(liveResponse.ok, `/health/live returned ${liveResponse.status}`);
  const live = await liveResponse.json();
  assert(live.ok === true && live.status === "live", "liveness failed");

  const healthResponse = await fetch(`${targetUrl}/health/ready`, {
    headers: { Accept: "application/json" },
  });
  assert(healthResponse.ok, `/health/ready returned ${healthResponse.status}`);
  const health = await healthResponse.json();
  assert(health.ok === true, "health ok=false");
  assert(health.status === "ready", `unexpected status ${health.status}`);
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

  let metricsChecked = false;
  if (metricsToken) {
    const metricsResponse = await fetch(`${targetUrl}/metrics`, {
      headers: {
        Accept: "text/plain",
        Authorization: `Bearer ${metricsToken}`,
      },
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
    metricsChecked = true;
  }

  console.log(
    JSON.stringify(
      {
        targetUrl,
        revision: health.revision,
        version: health.version,
        metricsChecked,
      },
      null,
      2,
    ),
  );
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
