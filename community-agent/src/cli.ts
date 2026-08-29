import { loadEnv } from './load-env.ts';
import {
  approveDraft,
  publishApprovedToFacebook,
  publishIfApproved,
  rejectDraft,
  reviewPending,
  runDaily,
} from './agent/orchestrator.ts';
import { logPublish, renderReviewCard } from './agent/approval.ts';
import { runDailyDiscovery } from './jobs/daily-discovery.ts';
import { runDailyDrafts } from './jobs/daily-drafts.ts';
import { runWeeklyReport } from './jobs/weekly-report.ts';
import { publishToFacebook } from './platforms/facebook.ts';

loadEnv();

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const urls = flags(rest, '--url');
  const id = rest.find((arg) => !arg.startsWith('--') && !urls.includes(arg));

  if (command === 'daily') {
    const result = await runDaily({ urls, enableReddit: !rest.includes('--no-reddit') });
    printDaily(result);
    return;
  }

  if (command === 'discover') {
    const result = await runDailyDiscovery({ urls, enableReddit: !rest.includes('--no-reddit') });
    console.log(`Reviewed ${result.reviewed}, engageable ${result.engageable}`);
    for (const item of result.scored) {
      console.log(`- ${item.scores.shouldReply ? 'KEEP' : 'skip'} ${item.conversation.url} (${item.scores.reasons.join('; ')})`);
    }
    return;
  }

  if (command === 'drafts') {
    const result = await runDailyDrafts({ urls, skipDiscover: rest.includes('--skip-discover') });
    printDaily(result);
    return;
  }

  if (command === 'weekly') {
    console.log(runWeeklyReport());
    return;
  }

  if (command === 'review') {
    const cards = reviewPending();
    if (!cards.length) {
      console.log('No pending drafts.');
      return;
    }
    for (const card of cards) console.log(renderReviewCard(card));
    return;
  }

  if (command === 'approve') {
    if (!id) throw new Error('Usage: approve <draftId>');
    const draft = approveDraft(id);
    console.log(`Approved ${draft.id}. Export a copy-paste card with: npx tsx src/cli.ts publish ${draft.id}`);
    return;
  }

  if (command === 'reject') {
    if (!id) throw new Error('Usage: reject <draftId>');
    console.log(`Rejected ${rejectDraft(id).id}`);
    return;
  }

  if (command === 'publish') {
    if (!id) throw new Error('Usage: publish <draftId> [--facebook] [--at ISO-datetime]');
    if (rest.includes('--facebook')) {
      const at = flagValue(rest, '--at');
      const { result } = await publishApprovedToFacebook(id, at ? new Date(at) : undefined);
      console.log(`${result.scheduled ? 'Scheduled' : 'Published'} ${result.url}`);
      return;
    }
    const draft = publishIfApproved(id);
    console.log(`Exported ${draft.id} for hand-publish. Pass --facebook to post via Graph API.`);
    return;
  }

  if (command === 'facebook-post') {
    const body = flagValue(rest, '--text');
    if (!body) throw new Error('Usage: facebook-post --text "..." [--at ISO-datetime]');
    if (!rest.includes('--approved')) {
      throw new Error('Refusing to post. Add --approved after a human signed off on this exact text.');
    }
    const at = flagValue(rest, '--at');
    const result = await publishToFacebook({
      message: body,
      scheduledAt: at ? new Date(at) : undefined,
    });
    logPublish(`Facebook ${result.scheduled ? 'scheduled' : 'published'} (manual text): ${result.url}`);
    console.log(`${result.scheduled ? 'Scheduled' : 'Published'} ${result.url}`);
    return;
  }

  console.log(`Usage:
  npx tsx src/cli.ts daily [--url URL] [--no-reddit]
  npx tsx src/cli.ts discover [--url URL] [--no-reddit]
  npx tsx src/cli.ts drafts [--skip-discover]
  npx tsx src/cli.ts weekly
  npx tsx src/cli.ts review
  npx tsx src/cli.ts approve <id>
  npx tsx src/cli.ts reject <id>
  npx tsx src/cli.ts publish <id> [--facebook] [--at ISO-datetime]
  npx tsx src/cli.ts facebook-post --text "..." --approved [--at ISO-datetime]`);
}

function flagValue(args: string[], name: string): string | undefined {
  return flags(args, name)[0];
}

function flags(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === name && args[i + 1]) {
      values.push(args[i + 1]);
      i += 1;
    }
  }
  return values;
}

function printDaily(result: Awaited<ReturnType<typeof runDaily>>): void {
  console.log(`Reviewed ${result.reviewed} · selected ${result.selected} · skipped ${result.skipped}`);
  console.log(renderReviewCard(result.card));
  console.log('Status: pending. Approve in chat or: npx tsx src/cli.ts approve', result.draft.id);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
