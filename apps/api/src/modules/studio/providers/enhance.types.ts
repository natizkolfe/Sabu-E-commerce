export type EnhanceInput = {
  buffer: Buffer;
  mime: string;
  productName?: string;
  /** When false (default), keep the photo and place on white canvas only. */
  removeBackground?: boolean;
};

export type EnhanceResult = {
  buffer: Buffer;
  mime: string;
  width: number;
  height: number;
  provider: string;
  providerJobId?: string;
  meta?: Record<string, unknown>;
};

export interface ImageEnhanceProvider {
  readonly name: string;
  enhanceToWhiteBackground(input: EnhanceInput): Promise<EnhanceResult>;
}
