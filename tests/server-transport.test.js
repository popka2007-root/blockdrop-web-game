import { describe, expect, it } from "vitest";
import transport from "../server-transport.js";

const {
  clientAddress,
  isLoopbackAddress,
  isSensitiveTransportAllowed,
  isTrustedProxyRequest,
} = transport;

function request({
  host = "45.148.117.119",
  remoteAddress = "203.0.113.10",
  encrypted = false,
  forwardedFor = "",
  forwardedProto = "",
} = {}) {
  return {
    headers: {
      host,
      ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
      ...(forwardedProto ? { "x-forwarded-proto": forwardedProto } : {}),
    },
    socket: { encrypted, remoteAddress },
  };
}

describe("trusted transport boundary", () => {
  it("does not let a remote client enable secure features with Host localhost", () => {
    expect(
      isSensitiveTransportAllowed(
        request({ host: "localhost", remoteAddress: "203.0.113.10" }),
        {},
      ),
    ).toBe(false);
    expect(
      isSensitiveTransportAllowed(
        request({ host: "localhost", remoteAddress: "::ffff:127.0.0.1" }),
        {},
      ),
    ).toBe(true);
  });

  it("trusts forwarding headers only from an approved proxy address", () => {
    const env = {
      BLOCKDROP_TRUST_PROXY: "true",
      BLOCKDROP_TRUSTED_PROXY_ADDRESSES: "10.0.0.2",
    };
    const untrusted = request({
      forwardedFor: "198.51.100.20",
      forwardedProto: "https",
    });
    const trusted = request({
      remoteAddress: "10.0.0.2",
      forwardedFor: "198.51.100.20",
      forwardedProto: "https",
    });
    expect(isTrustedProxyRequest(untrusted, env)).toBe(false);
    expect(isSensitiveTransportAllowed(untrusted, env)).toBe(false);
    expect(clientAddress(untrusted, env)).toBe("203.0.113.10");
    expect(isTrustedProxyRequest(trusted, env)).toBe(true);
    expect(isSensitiveTransportAllowed(trusted, env)).toBe(true);
    expect(clientAddress(trusted, env)).toBe("198.51.100.20");
  });

  it("recognizes IPv4 and IPv6 loopback forms", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("127.0.0.999")).toBe(false);
    expect(isLoopbackAddress("10.0.0.1")).toBe(false);
    expect(
      isSensitiveTransportAllowed(
        request({ host: "[::1]:8787", remoteAddress: "::1" }),
        {},
      ),
    ).toBe(true);
  });
});
