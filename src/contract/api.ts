import type {
  FeedPage,
  ListFeedQuery,
  MarkFeedReadInput,
  SendRequest,
  SendResult,
} from './contract';

export interface ChaskiFeedApi {
  list(query: ListFeedQuery): Promise<FeedPage>;
  unreadCount(recipientId: string): Promise<{ unread: number }>;
  markRead(input: MarkFeedReadInput): Promise<{ marked: number }>;
}

/** chaski's in-process API: the host's Worker calls it directly, with no HTTP in between. */
export interface ChaskiApi {
  send(request: SendRequest): Promise<SendResult>;
  readonly feed: ChaskiFeedApi;
}
