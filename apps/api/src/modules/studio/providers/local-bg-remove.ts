import { Logger } from '@nestjs/common';
import { edgeFloodCutout } from './edge-flood-cutout';

const logger = new Logger('LocalBgRemove');

/**
 * Local cutout without Photoroom.
 * Uses edge flood-fill (IMG.LY onnx crashes on some Windows setups).
 */
export async function removeBackgroundLocal(
  input: Buffer,
): Promise<Buffer | null> {
  try {
    return await edgeFloodCutout(input);
  } catch (err) {
    logger.warn(`local bg removal failed: ${(err as Error).message}`);
    return null;
  }
}
