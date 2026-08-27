import { ProviderDescriptor, ProviderEvent, ProviderRequest } from "../../core/provider-contracts";

export interface ModelProvider {
  readonly descriptor: ProviderDescriptor;
  stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>;
}
