import { ProviderAuthField, ProviderProfile, ProviderProfileConfiguration } from "../../../../core/provider-contracts";

export type ProviderErrorKind =
  | "authentication"
  | "quota"
  | "rate-limit"
  | "model-or-permission"
  | "invalid-request"
  | "network"
  | "network-blocked"
  | "server"
  | "cancelled";

export class ProviderTransportError extends Error {
  constructor(readonly kind: ProviderErrorKind, readonly status?: number) {
    super(providerErrorMessage(kind, status));
  }
}

export type SecretResolver = (fieldId: string) => Promise<string | null>;

export interface ProviderTransportOptions {
  profile: ProviderProfile;
  configuration: ProviderProfileConfiguration;
  resolveSecret: SecretResolver;
  fetchImpl?: typeof fetch;
  allowExternalNetwork?: boolean;
}

export class ProviderTransport {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ProviderTransportOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  endpoint(): string {
    const configured = this.options.configuration.endpoint?.trim();
    const endpoint = configured || this.options.profile.endpoint.defaultUrl;
    if (!endpoint || !/^https?:\/\//u.test(endpoint)) {
      throw new ProviderTransportError("invalid-request");
    }
    return endpoint;
  }

  async request(init: RequestInit, endpoint = this.endpoint()): Promise<Response> {
    const url = new URL(endpoint);
    if (this.options.allowExternalNetwork === false && !isLoopbackHost(url.hostname)) {
      throw new ProviderTransportError("network-blocked");
    }
    if (this.options.configuration.network?.tlsVerification !== undefined
      && this.options.configuration.network.tlsVerification !== "required") {
      throw new ProviderTransportError("invalid-request");
    }
    const auth = await this.resolveAuthentication(this.options.profile.auth);
    for (const [name, value] of auth.query) url.searchParams.set(name, value);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...init,
        headers: { ...this.options.profile.staticHeaders, ...init.headers, ...auth.headers },
      });
    } catch (error) {
      if (init.signal?.aborted || isAbortError(error)) throw new ProviderTransportError("cancelled");
      throw new ProviderTransportError("network");
    }
    if (!response.ok) throw mapHttpError(response.status);
    return response;
  }

  private async resolveAuthentication(fields: ProviderAuthField[]): Promise<{
    headers: Record<string, string>;
    query: Array<[string, string]>;
  }> {
    const headers: Record<string, string> = {};
    const query: Array<[string, string]> = [];
    for (const field of fields) {
      const secret = await this.options.resolveSecret(field.id);
      if (!secret) {
        if (field.required) throw new ProviderTransportError("authentication");
        continue;
      }
      const value = `${field.prefix ?? ""}${secret}`;
      if (field.placement === "header") headers[field.name] = value;
      else query.push([field.name, value]);
    }
    return { headers, query };
  }
}

export function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

export function mapHttpError(status: number): ProviderTransportError {
  if (status === 401) return new ProviderTransportError("authentication", status);
  if (status === 402) return new ProviderTransportError("quota", status);
  if (status === 403 || status === 404) return new ProviderTransportError("model-or-permission", status);
  if (status === 429) return new ProviderTransportError("rate-limit", status);
  if (status >= 500) return new ProviderTransportError("server", status);
  return new ProviderTransportError("invalid-request", status);
}

function providerErrorMessage(kind: ProviderErrorKind, status?: number): string {
  const suffix = status ? `（${status}）` : "";
  switch (kind) {
    case "authentication": return `Provider 鉴权失败${suffix}。`;
    case "quota": return `Provider 余额或配额不足${suffix}。`;
    case "rate-limit": return `Provider 请求过于频繁${suffix}。`;
    case "model-or-permission": return `模型不存在或当前账户无权限${suffix}。`;
    case "invalid-request": return `Provider 请求无效${suffix}。`;
    case "network": return "无法连接 Provider。";
    case "network-blocked": return "本阶段仅允许 localhost fake Provider；未发起外网请求。";
    case "server": return `Provider 服务暂时不可用${suffix}。`;
    case "cancelled": return "Provider 请求已取消。";
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || /abort|cancel/iu.test(error.message));
}
