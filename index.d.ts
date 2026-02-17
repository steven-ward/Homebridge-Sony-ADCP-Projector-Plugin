import {
  API,
  DynamicPlatformPlugin,
  Logging,
  PlatformConfig,
} from "homebridge";

export interface InputConfig {
  id: number;
  name: string;
  adcp: string;
}

export interface ModeConfig {
  name: string;
  code: string;
}

export interface SonyProjectorConfig extends PlatformConfig {
  ip: string;
  adcpPort?: number;
  useAuth?: boolean;
  password?: string;
  timeout?: number;
  inputs?: InputConfig[];
  enableBrightness?: boolean;
  enableHdrSelector?: boolean;
  enableTestPatterns?: boolean;
  enableLampHoursSensor?: boolean;
  enableBlankScreen?: boolean;
  enableContrast?: boolean;
  enablePictureModes?: boolean;
  enableErrorSensor?: boolean;
  enablePolling?: boolean;
  pollingInterval?: number;
  pictureModes?: ModeConfig[];
  hdrModes?: ModeConfig[];
  testPatterns?: ModeConfig[];
  staticModel?: string;
  staticSerial?: string;
  logging?: "none" | "standard" | "debug";
}

export class SonyProjectorPlatform implements DynamicPlatformPlugin {
  constructor(log: Logging, config: SonyProjectorConfig, api: API);
  configureAccessory(accessory: any): void;
}

export declare function defaultExport(api: API): void;
export default defaultExport;
