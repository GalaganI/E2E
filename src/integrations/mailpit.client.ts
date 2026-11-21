import type { APIRequestContext } from '@playwright/test';
import { z } from 'zod';
import { parseBody } from '@/api/api-response';
import { pollUntil } from '@/utils/wait';

const Address = z.object({ Name: z.string(), Address: z.string() });

const MessageSummarySchema = z.object({
  ID: z.string(),
  Subject: z.string(),
  To: z.array(Address),
  From: Address,
  Created: z.string(),
});

const SearchResultSchema = z.object({
  total: z.number(),
  messages: z.array(MessageSummarySchema),
});

const MessageSchema = z.object({
  ID: z.string(),
  Subject: z.string(),
  From: Address,
  To: z.array(Address),
  Text: z.string(),
  HTML: z.string(),
  Attachments: z.array(z.object({ PartID: z.string(), FileName: z.string(), ContentType: z.string() })),
});

export type MailSummary = z.infer<typeof MessageSummarySchema>;
export type Mail = z.infer<typeof MessageSchema>;

/**
 * Reusable client for the Mailpit REST API (https://mailpit.axllent.org/docs/api-v1/).
 * Tests address mail by unique recipient, so parallel workers never read each other's mail
 * and the shared inbox never needs a global purge.
 */
export class MailpitClient {
  constructor(private readonly request: APIRequestContext) {}

  async search(query: string): Promise<MailSummary[]> {
    const response = await this.request.get('/api/v1/search', { params: { query, limit: 50 } });
    return (await parseBody(response, SearchResultSchema)).messages;
  }

  async getMessage(id: string): Promise<Mail> {
    return parseBody(await this.request.get(`/api/v1/message/${id}`), MessageSchema);
  }

  async getHeaders(id: string): Promise<Record<string, string[]>> {
    const response = await this.request.get(`/api/v1/message/${id}/headers`);
    return (await response.json()) as Record<string, string[]>;
  }

  async getAttachment(messageId: string, partId: string): Promise<string> {
    return (await this.request.get(`/api/v1/message/${messageId}/part/${partId}`)).text();
  }

  /**
   * Waits for mail to arrive. Handles delayed delivery by polling with backoff instead of
   * sleeping; resolves as soon as `count` matching messages exist. Newest message first.
   */
  async waitForMessages(
    { to, subject }: { to: string; subject?: string },
    { count = 1, timeoutMs = 15_000 } = {},
  ): Promise<Mail[]> {
    const query = [`to:"${to}"`, subject ? `subject:"${subject}"` : ''].filter(Boolean).join(' ');
    const summaries = await pollUntil(
      () => this.search(query),
      (messages) => messages.length >= count,
      { timeoutMs, description: `${count} e-mail(s) matching [${query}]` },
    );
    return Promise.all(summaries.map((m) => this.getMessage(m.ID)));
  }

  async waitForMessage(
    criteria: { to: string; subject?: string },
    options?: { timeoutMs?: number },
  ): Promise<Mail> {
    const [message] = await this.waitForMessages(criteria, { count: 1, ...options });
    if (!message) throw new Error('Unreachable: waitForMessages resolved without messages');
    return message;
  }

  /** Extracts every absolute link from the HTML part, optionally filtered by anchor id. */
  static links(mail: Mail, { anchorId }: { anchorId?: string } = {}): string[] {
    const pattern = /<a\b([^>]*)href="([^"]+)"/g;
    const links: string[] = [];
    for (const match of mail.HTML.matchAll(pattern)) {
      const attributes = match[1] ?? '';
      if (anchorId && !attributes.includes(`id="${anchorId}"`)) continue;
      if (match[2]) links.push(match[2].replaceAll('&amp;', '&'));
    }
    return links;
  }

  async deleteFor(to: string): Promise<void> {
    await this.request.delete('/api/v1/search', { params: { query: `to:"${to}"` } });
  }
}
