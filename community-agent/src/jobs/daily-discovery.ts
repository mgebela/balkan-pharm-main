import { discoverConversations, type DiscoveryInput } from '../agent/discovery.ts';
import { loadMemory, rememberConversation } from '../agent/memory.ts';
import { scoreConversation } from '../agent/relevance.ts';
import { newId } from '../db/client.ts';
import { loadConfig } from '../load-config.ts';

export async function runDailyDiscovery(input: DiscoveryInput = {}) {
  const config = loadConfig();
  const conversations = await discoverConversations({
    ...input,
    pillars: input.pillars ?? config.pillars,
  });

  const scored = conversations.map((conversation) => {
    const scores = scoreConversation(conversation, config.pillars);
    rememberConversation({
      id: newId('convo'),
      platform: conversation.platform,
      url: conversation.url,
      author: conversation.author,
      title: conversation.title,
      excerpt: conversation.excerpt,
      discoveredAt: new Date().toISOString(),
      scores,
    });
    return { conversation, scores };
  });

  return {
    reviewed: scored.length,
    engageable: scored.filter((item) => item.scores.shouldReply).length,
    memory: loadMemory().recentConversations.slice(0, 8),
    scored,
  };
}
