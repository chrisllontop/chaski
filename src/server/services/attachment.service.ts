import type { AttachmentInput } from '../../contract/contract';
import { ChaskiError } from '../../contract/errors';
import { parseJson } from '../lib/json';
import { BaseService } from './base.service';

export type StoredAttachment = {
  r2Key: string;
  filename: string;
  contentType: string;
  disposition?: 'attachment' | 'inline';
  contentId?: string;
};

const decodeBase64 = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

// Attachment bodies never travel through the queue (128 KB message cap); they
// are persisted to R2 at ingest and read back by the channel adapter at send time.
export class AttachmentService extends BaseService {
  protected static override name = 'attachments';

  static store = async (
    ownerId: string,
    attachments: AttachmentInput[],
  ): Promise<StoredAttachment[]> => {
    const stored: StoredAttachment[] = [];
    if (attachments.length === 0) return stored;
    const bucket = AttachmentService.bindings.attachments;
    if (!bucket) {
      throw new ChaskiError(
        'config',
        'email attachments need the CHASKI_ATTACHMENTS binding (an R2 bucket)',
      );
    }
    for (let i = 0; i < attachments.length; i++) {
      const attachment = attachments[i];
      if (!attachment) continue;
      const r2Key = `att/${ownerId}/${i}-${attachment.filename}`;
      let body: Uint8Array | ArrayBuffer;
      if (attachment.content) {
        body = decodeBase64(attachment.content);
      } else if (attachment.url) {
        const res = await fetch(attachment.url);
        if (!res.ok) {
          throw new Error(`attachment fetch failed (${res.status}) for ${attachment.url}`);
        }
        body = await res.arrayBuffer();
      } else {
        continue;
      }
      await bucket.put(r2Key, body, {
        httpMetadata: { contentType: attachment.contentType },
      });
      stored.push({
        r2Key,
        filename: attachment.filename,
        contentType: attachment.contentType,
        disposition: attachment.disposition,
        contentId: attachment.contentId,
      });
    }
    return stored;
  };

  /**
   * Deletes attachments nothing reads again: those of an email that went out, and of a
   * schedule cancelled or replaced. A failed or dead delivery keeps its own, for a replay.
   */
  static discard = async (
    stored: StoredAttachment[] | string | null,
    context: { deliveryId?: string; scheduledId?: string; channel?: string },
  ): Promise<void> => {
    const keys = (
      typeof stored === 'string' ? parseJson<StoredAttachment[]>(stored, []) : (stored ?? [])
    ).map((attachment) => attachment.r2Key);
    const bucket = AttachmentService.bindings.attachments;
    if (keys.length === 0 || !bucket) return;
    // What they were attached to already happened; a leftover file costs storage, not a send.
    try {
      await bucket.delete(keys);
    } catch (error) {
      AttachmentService.log.error('attachments not deleted', error, {
        ...context,
        keys: keys.length,
      });
    }
  };

  static read = async (stored: StoredAttachment): Promise<ArrayBuffer | null> => {
    const object = await AttachmentService.bindings.attachments?.get(stored.r2Key);
    if (!object) return null;
    return object.arrayBuffer();
  };
}
