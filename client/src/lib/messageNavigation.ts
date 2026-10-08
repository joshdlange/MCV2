export interface MessageUser {
  id: number;
  username: string;
  displayName: string | null;
  photoURL?: string | null;
  collectorAvatarKey?: string | null;
  isFriend?: boolean;
}

export interface MessageThread {
  user: MessageUser;
  lastMessage: { content: string; createdAt: string; senderId: number };
  unreadCount?: number;
}

export type ConversationFilter = "all" | "unread" | "friends";

// Filter only: keep the server's chronological order and original thread objects.
export function filterMessageThreads(
  threads: MessageThread[],
  search: string,
  filter: ConversationFilter,
  friendIds: ReadonlySet<number>,
) {
  const term = search.trim().toLocaleLowerCase();
  return threads.filter(thread =>
    (filter !== "unread" || (thread.unreadCount ?? 0) > 0) &&
    (filter !== "friends" || friendIds.has(thread.user.id)) &&
    (!term || [thread.user.username, thread.user.displayName, thread.lastMessage.content]
      .some(value => value?.toLocaleLowerCase().includes(term))),
  );
}

export function resolveMessageUser(
  id: number | null,
  threads: MessageThread[],
  selected: MessageUser | null,
  friends: MessageUser[],
  senders: MessageUser[],
) {
  if (id === null) return undefined;
  return threads.find(thread => thread.user.id === id)?.user ??
    (selected?.id === id ? selected : undefined) ??
    friends.find(friend => friend.id === id) ??
    senders.find(sender => sender.id === id);
}
