import { describe, expect, it } from 'vitest';
import type { ChaskiError } from '../src';
import { getClient } from '../src/server/db';
import { TemplateService } from '../src/server/services/template.service';
import { seedTemplate } from './helpers';

describe('template soft deletion', () => {
  it('hides a deleted template while preserving its channel content', async () => {
    await seedTemplate('reminder', 'email');

    await TemplateService.deleteTemplate('tpl_reminder');

    const client = getClient();
    expect(await client.templates.findFirst({ where: { id: 'tpl_reminder' } })).toBeNull();
    expect(await client.templates.count()).toBe(0);
    expect(await client.templates.exists({ where: { id: 'tpl_reminder' } })).toBe(false);

    const deleted = await client.templates.findFirst({
      where: { id: 'tpl_reminder' },
      deleted: 'only',
    });
    expect(deleted?.deletedAt).toBeInstanceOf(Date);
    expect(
      await client.templateChannels.findFirst({ where: { templateId: 'tpl_reminder' } }),
    ).not.toBeNull();
  });

  it('excludes tombstones from every ordinary read delegate', async () => {
    await seedTemplate('reminder', 'email');
    await TemplateService.deleteTemplate('tpl_reminder');

    const client = getClient();
    expect(await client.templates.findOne({ where: { id: 'tpl_reminder' } })).toBeNull();
    expect(await client.templates.findUnique({ where: { id: 'tpl_reminder' } })).toBeNull();
    const page = await client.templates.paginate({ limit: 10 });
    expect(page.data).toEqual([]);
  });

  it('makes deleted templates unavailable to application behavior', async () => {
    await seedTemplate('reminder', 'email');
    await TemplateService.deleteTemplate('tpl_reminder');

    expect(await TemplateService.hasType('reminder')).toBe(false);
    expect(await TemplateService.findActiveContent('reminder', 'email')).toBeNull();
    await expect(TemplateService.get('tpl_reminder')).rejects.toMatchObject({
      code: 'not_found',
    } satisfies Partial<ChaskiError>);
    await expect(TemplateService.deleteTemplate('tpl_reminder')).rejects.toMatchObject({
      code: 'not_found',
    } satisfies Partial<ChaskiError>);
  });

  it('allows a business key to be reused after deletion', async () => {
    await seedTemplate('reminder', 'email');
    await TemplateService.deleteTemplate('tpl_reminder');

    const recreated = await TemplateService.createTemplate({ type: 'reminder' });
    expect(recreated.id).not.toBe('tpl_reminder');
    expect((await TemplateService.getByType('reminder')).template.id).toBe(recreated.id);
    expect(
      await getClient().templates.findFirst({ where: { id: 'tpl_reminder' }, deleted: 'only' }),
    ).not.toBeNull();
  });

  it('hard-purges only an already deleted template and cascades its channels', async () => {
    await seedTemplate('reminder', 'email');

    await expect(TemplateService.purgeTemplate('tpl_reminder')).rejects.toMatchObject({
      code: 'not_found',
    } satisfies Partial<ChaskiError>);

    await TemplateService.deleteTemplate('tpl_reminder');
    await TemplateService.purgeTemplate('tpl_reminder');

    expect(
      await getClient().templates.findFirst({ where: { id: 'tpl_reminder' }, deleted: 'with' }),
    ).toBeNull();
    expect(
      await getClient().templateChannels.findFirst({ where: { templateId: 'tpl_reminder' } }),
    ).toBeNull();
  });

  it('turns bulk delete into logical deletion for soft-deletable models', async () => {
    await seedTemplate('first', 'email');
    await seedTemplate('second', 'email');

    const result = await getClient().templates.deleteMany({
      where: { type: { in: ['first', 'second'] } },
    });

    expect(result.count).toBe(2);
    expect(await getClient().templates.findMany()).toEqual([]);
    expect(await getClient().templates.count({ deleted: 'only' })).toBe(2);
  });
});
