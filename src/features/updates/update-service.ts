import { PRODUCT_VERSION } from "../../core/contracts";
import { UpdateChannel, UpdateFeed, UpdateSnapshot, UpdateStatus } from "../../core/cp7-contracts";

export interface UpdateTransport {
  fetchFeed(channel: UpdateChannel): Promise<UpdateFeed>;
  download(asset: string): Promise<{ path: string }>;
  install?(path: string): Promise<void>;
}

export interface UpdateServiceOptions {
  transport?: UpdateTransport;
  currentVersion?: string;
  officialEndpoint?: string;
}

export class UpdateService {
  private state: UpdateSnapshot;
  private transport?: UpdateTransport;
  private feed?: UpdateFeed;
  private downloadedPath?: string;

  constructor(options: UpdateServiceOptions = {}) {
    this.transport = options.officialEndpoint && !isLoopback(options.officialEndpoint) ? undefined : options.transport;
    this.state = { channel: "preview", status: "idle", currentVersion: options.currentVersion ?? PRODUCT_VERSION, officialSourceConfigured: Boolean(this.transport), activeRunCount: 0 };
  }

  snapshot(): UpdateSnapshot { return { ...this.state }; }

  setChannel(channel: UpdateChannel): void { this.state = { ...this.state, channel }; }

  setActiveRunCount(count: number): void { this.state.activeRunCount = Math.max(0, Math.floor(count)); }

  async check(channel: UpdateChannel): Promise<UpdateSnapshot> {
    this.state = { ...this.state, channel, status: "idle", failure: undefined };
    if (!this.transport) return this.setStatus("unavailable");
    try {
      this.feed = await this.transport.fetchFeed(channel);
      if (this.feed.channel !== channel) throw new Error("更新源通道不匹配。");
      if (this.feed.version === this.state.currentVersion) return this.setStatus("no-update");
      this.state = { ...this.state, status: "available", availableVersion: this.feed.version, notes: this.feed.notes };
      return this.snapshot();
    } catch (error) {
      this.state = { ...this.state, status: "failed", failure: error instanceof Error ? error.message : String(error) };
      return this.snapshot();
    }
  }

  async download(): Promise<UpdateSnapshot> {
    if (!this.transport || !this.feed) return this.setStatus("unavailable");
    if (this.state.activeRunCount > 0) return this.setStatus("waiting-idle");
    try {
      this.state = { ...this.state, status: "downloading" };
      this.downloadedPath = (await this.transport.download(this.feed.asset)).path;
      return this.setStatus("ready");
    } catch (error) {
      this.state = { ...this.state, status: "failed", failure: error instanceof Error ? error.message : String(error) };
      return this.snapshot();
    }
  }

  async confirmInstall(): Promise<UpdateSnapshot> {
    if (this.state.status !== "ready") return this.snapshot();
    if (this.state.activeRunCount > 0) return this.setStatus("waiting-idle");
    this.state = { ...this.state, status: "installing" };
    try {
      if (this.transport?.install && this.downloadedPath) await this.transport.install(this.downloadedPath);
      this.state = { ...this.state, currentVersion: this.feed?.version ?? this.state.currentVersion };
      return this.setStatus("installed");
    } catch (error) {
      this.state = { ...this.state, status: "failed", failure: error instanceof Error ? error.message : String(error) };
      return this.snapshot();
    }
  }

  private setStatus(status: UpdateStatus): UpdateSnapshot { this.state = { ...this.state, status }; return this.snapshot(); }
}

function isLoopback(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  } catch {
    return false;
  }
}
