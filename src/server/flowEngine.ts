import type { BotRecord, FlowNode, FlowRecord, MessageType } from '../types.ts';
import { sendTelegramMessage, sendViberMessage } from './botApis.ts';

export interface FlowExecutionStepLog {
  nodeId: string;
  nodeType: string;
  label: string;
  status: 'executed' | 'skipped' | 'failed';
  detail?: string;
}

export interface FlowExecutionContext {
  bot: BotRecord;
  plainToken: string;
  platformUserId: string;
  customerId: string;
  incomingText: string;
  dryRun?: boolean;
  onOutgoingMessage?: (msg: {
    messageType: MessageType;
    text?: string;
    mediaUrl?: string;
    platformMessageId?: string;
    status: 'sent' | 'failed';
    errorMessage?: string;
  }) => void;
}

const MAX_FLOW_STEPS = 25;

function matchesKeyword(text: string, keyword: string, mode: 'contains' | 'exact' | 'starts_with'): boolean {
  const haystack = text.trim().toLowerCase();
  const needle = keyword.trim().toLowerCase();
  if (!needle) return true;
  if (mode === 'exact') return haystack === needle;
  if (mode === 'starts_with') return haystack.startsWith(needle);
  return haystack.includes(needle);
}

function evaluateCondition(node: FlowNode, ctx: FlowExecutionContext): boolean {
  const fieldVal =
    node.config.conditionField === 'platform' ? ctx.bot.platform : ctx.incomingText;
  const target = (node.config.conditionValue || '').toLowerCase();
  const actual = (fieldVal || '').toLowerCase();
  const op = node.config.conditionOperator || 'contains';

  if (op === 'equals') return actual === target;
  if (op === 'not_equals') return actual !== target;
  return actual.includes(target);
}

export async function executeFlow(
  flow: FlowRecord,
  ctx: FlowExecutionContext
): Promise<{ executed: boolean; steps: FlowExecutionStepLog[] }> {
  const steps: FlowExecutionStepLog[] = [];
  if (!flow.nodes || flow.nodes.length === 0) {
    return { executed: false, steps };
  }

  // Find entry node: keyword_trigger matching incomingText first, otherwise start node
  const keywordNodes = flow.nodes.filter((n) => n.type === 'keyword_trigger');
  let entryNode: FlowNode | undefined;

  if (keywordNodes.length > 0) {
    entryNode = keywordNodes.find((n) =>
      matchesKeyword(
        ctx.incomingText,
        n.config.keyword || '',
        n.config.matchMode || 'contains'
      )
    );
    if (!entryNode) {
      return { executed: false, steps };
    }
  } else {
    entryNode = flow.nodes.find((n) => n.type === 'start') || flow.nodes[0];
  }

  const visited = new Set<string>();
  let current: FlowNode | undefined = entryNode;
  let stepCount = 0;

  while (current && stepCount < MAX_FLOW_STEPS) {
    if (visited.has(current.id)) {
      steps.push({
        nodeId: current.id,
        nodeType: current.type,
        label: current.label,
        status: 'skipped',
        detail: 'Cycle prevented by loop guard',
      });
      break;
    }

    visited.add(current.id);
    stepCount++;

    let branchChoice: 'default' | 'true' | 'false' = 'default';

    if (current.type === 'start') {
      steps.push({ nodeId: current.id, nodeType: current.type, label: current.label, status: 'executed' });
    } else if (current.type === 'keyword_trigger') {
      const matched = matchesKeyword(
        ctx.incomingText,
        current.config.keyword || '',
        current.config.matchMode || 'contains'
      );
      if (!matched) {
        steps.push({
          nodeId: current.id,
          nodeType: current.type,
          label: current.label,
          status: 'skipped',
          detail: 'Keyword did not match',
        });
        break;
      }
      steps.push({
        nodeId: current.id,
        nodeType: current.type,
        label: current.label,
        status: 'executed',
        detail: `Matched "${current.config.keyword || '*'}"`,
      });
    } else if (current.type === 'delay') {
      const sec = Math.min(Math.max(Number(current.config.delaySeconds || 1), 0), 15);
      if (!ctx.dryRun && sec > 0) {
        await new Promise((r) => setTimeout(r, sec * 1000));
      }
      steps.push({
        nodeId: current.id,
        nodeType: current.type,
        label: current.label,
        status: 'executed',
        detail: ctx.dryRun ? `Simulated ${sec}s delay` : `Waited ${sec}s`,
      });
    } else if (current.type === 'condition') {
      const result = evaluateCondition(current, ctx);
      branchChoice = result ? 'true' : 'false';
      steps.push({
        nodeId: current.id,
        nodeType: current.type,
        label: current.label,
        status: 'executed',
        detail: `Evaluated -> ${branchChoice.toUpperCase()}`,
      });
    } else if (current.type === 'customer_reply') {
      steps.push({
        nodeId: current.id,
        nodeType: current.type,
        label: current.label,
        status: 'executed',
        detail: `Captured customer input: "${ctx.incomingText.slice(0, 40)}"`,
      });
    } else if (
      current.type === 'send_message' ||
      current.type === 'send_image' ||
      current.type === 'send_audio'
    ) {
      const messageType: MessageType =
        current.type === 'send_image'
          ? 'image'
          : current.type === 'send_audio'
          ? 'audio'
          : 'text';

      const text = current.config.text || '';
      const mediaUrl = current.config.mediaUrl || '';

      if (ctx.dryRun) {
        steps.push({
          nodeId: current.id,
          nodeType: current.type,
          label: current.label,
          status: 'executed',
          detail: `Dry run (${messageType}): ${text || mediaUrl}`,
        });
      } else {
        const res =
          ctx.bot.platform === 'telegram'
            ? await sendTelegramMessage(ctx.plainToken, ctx.platformUserId, {
                messageType,
                text,
                mediaUrl,
              })
            : await sendViberMessage(ctx.plainToken, ctx.platformUserId, {
                messageType,
                text,
                mediaUrl,
                senderName: ctx.bot.name,
              });

        ctx.onOutgoingMessage?.({
          messageType,
          text,
          mediaUrl,
          platformMessageId: res.platformMessageId,
          status: res.ok ? 'sent' : 'failed',
          errorMessage: res.error,
        });

        steps.push({
          nodeId: current.id,
          nodeType: current.type,
          label: current.label,
          status: res.ok ? 'executed' : 'failed',
          detail: res.ok ? `Sent ${messageType} reply` : res.error,
        });
      }
    } else if (current.type === 'end') {
      steps.push({ nodeId: current.id, nodeType: current.type, label: current.label, status: 'executed' });
      break;
    }

    // Advance along matching edge
    const outgoingEdges = flow.edges.filter((e) => e.sourceId === current?.id);
    const chosenEdge =
      outgoingEdges.find((e) => (e.branch || 'default') === branchChoice) ||
      outgoingEdges[0];

    if (!chosenEdge) break;
    current = flow.nodes.find((n) => n.id === chosenEdge.targetId);
  }

  return { executed: steps.length > 0, steps };
}
