function requestHostName(req) {
  const host = String(req?.headers?.host || "").trim();
  if (!host) return "";
  try {
    return normalizeAddress(new URL(`http://${host}`).hostname);
  } catch {
    return "";
  }
}

function normalizeAddress(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .split("%")[0];
}

function isLoopbackAddress(value) {
  const address = normalizeAddress(value);
  if (address === "::1") return true;
  const ipv4 = address.startsWith("::ffff:")
    ? address.slice("::ffff:".length)
    : address;
  const octets = ipv4.split(".");
  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every(
      (octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255,
    )
  );
}

function trustedProxyAddresses(env = process.env) {
  return new Set(
    String(env.BLOCKDROP_TRUSTED_PROXY_ADDRESSES || "")
      .split(",")
      .map(normalizeAddress)
      .filter(Boolean),
  );
}

function isTrustedProxyRequest(req, env = process.env) {
  if (env.BLOCKDROP_TRUST_PROXY !== "true") return false;
  const remoteAddress = normalizeAddress(req?.socket?.remoteAddress);
  return (
    isLoopbackAddress(remoteAddress) ||
    trustedProxyAddresses(env).has(remoteAddress)
  );
}

function isSensitiveTransportAllowed(req, env = process.env) {
  if (env.BLOCKDROP_ALLOW_INSECURE_AUTH === "true") return true;
  if (req?.socket?.encrypted) return true;
  if (isTrustedProxyRequest(req, env)) {
    const forwardedProtocol = String(req?.headers?.["x-forwarded-proto"] || "")
      .split(",")[0]
      .trim()
      .toLowerCase();
    if (forwardedProtocol === "https") return true;
  }
  const hostname = requestHostName(req);
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(hostname);
  return localHost && isLoopbackAddress(req?.socket?.remoteAddress);
}

function clientAddress(req, env = process.env) {
  if (isTrustedProxyRequest(req, env)) {
    const forwardedAddress = String(req?.headers?.["x-forwarded-for"] || "")
      .split(",")[0]
      .trim();
    if (forwardedAddress) return forwardedAddress.slice(0, 80);
  }
  return String(req?.socket?.remoteAddress || "unknown").slice(0, 80);
}

module.exports = {
  clientAddress,
  isLoopbackAddress,
  isSensitiveTransportAllowed,
  isTrustedProxyRequest,
  requestHostName,
};
