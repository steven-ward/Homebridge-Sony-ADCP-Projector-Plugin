import { API, AccessoryPlugin, Logging, AccessoryConfig } from "homebridge";

export interface InputConfig {
  id: number;
  name: string;
  adcp: string;
}

export interface ModeConfig {
  name: string;
  code: number;
}

export interface SonyProjectorConfig extends AccessoryConfig {
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
  pictureModes?: ModeConfig[];
  hdrModes?: ModeConfig[];
  testPatterns?: ModeConfig[];
  staticModel?: string;
  staticSerial?: string;
  logging?: "none" | "standard" | "debug";
  uiLayout?: "inputs_only" | "mixed_virtual";
  enablePolling?: boolean;
  pollingInterval?: number;
}

export class SonyProjectorAccessory implements AccessoryPlugin {
  constructor(log: Logging, config: SonyProjectorConfig, api: API);
  getServices(): any[];
}

export declare function defaultExport(api: API): void;
export default defaultExport;
