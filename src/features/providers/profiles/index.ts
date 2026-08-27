import { ProviderProfile } from "../../../core/provider-contracts";
import { CUSTOM_PROFILES } from "./custom";
import { DOMESTIC_MODEL_PROFILES } from "./domestic-models";
import { DOMESTIC_PLATFORM_PROFILES } from "./domestic-platforms";
import { INTERNATIONAL_PROFILES } from "./international";

export const PROVIDER_PROFILES: ProviderProfile[] = [
  ...INTERNATIONAL_PROFILES,
  ...DOMESTIC_MODEL_PROFILES,
  ...DOMESTIC_PLATFORM_PROFILES,
  ...CUSTOM_PROFILES,
];
