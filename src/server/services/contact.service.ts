import type { Recipient } from '../../contract/contract';
import { ChaskiError } from '../../contract/errors';
import { BaseService } from './base.service';

export type ContactSnapshot = {
  email?: string;
  name?: string;
  phoneE164?: string;
  timezone?: string;
  locale?: string;
};

export class ContactService extends BaseService {
  // Merge semantics: only fields present in the request overwrite stored values,
  // so a send without `phone` never clears a phone an earlier send captured.
  static upsertFromRecipient = async (recipient: Recipient): Promise<ContactSnapshot> => {
    type ProvidedColumn = 'email' | 'name' | 'phoneE164' | 'timezone' | 'locale';
    const provided: Record<ProvidedColumn, string | undefined> = {
      email: recipient.email,
      name: recipient.name,
      phoneE164: recipient.phone,
      timezone: recipient.timezone,
      locale: recipient.locale,
    };
    const updateColumns = (Object.keys(provided) as ProvidedColumn[]).filter(
      (key) => provided[key] !== undefined,
    );

    await ContactService.client.contacts.upsertMany({
      data: [
        {
          recipientId: recipient.id,
          email: recipient.email ?? null,
          name: recipient.name ?? null,
          phoneE164: recipient.phone ?? null,
          timezone: recipient.timezone ?? null,
          locale: recipient.locale ?? null,
        },
      ],
      target: ['recipientId'],
      update: [...updateColumns, 'updatedAt'],
    });

    const row = await ContactService.client.contacts.findFirst({
      where: { recipientId: recipient.id },
    });
    if (!row) throw new ChaskiError('internal', 'contact upsert did not persist');
    return {
      email: row.email ?? undefined,
      name: row.name ?? undefined,
      phoneE164: row.phoneE164 ?? undefined,
      timezone: row.timezone ?? undefined,
      locale: row.locale ?? undefined,
    };
  };
}
