import React, { useMemo, useState } from 'react';
import {
  Plus,
  Save,
  Play,
  Trash2,
  GitBranch,
  Power,
  Link2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { authFetch } from '../lib/apiClient';
import type {
  FlowEdge,
  FlowNode,
  FlowNodeType,
  FlowRecord,
  Platform,
} from '../types';

const NODE_PALETTE: Array<{ type: FlowNodeType; label: string; color: string }> = [
  { type: 'start', label: 'Start', color: 'border-emerald-500/50 bg-emerald-950/40' },
  { type: 'keyword_trigger', label: 'Keyword Trigger', color: 'border-amber-500/50 bg-amber-950/40' },
  { type: 'send_message', label: 'Send Message', color: 'border-[#D4AF37]/60 bg-[#7F1D1D]/40' },
  { type: 'send_image', label: 'Send Image', color: 'border-rose-500/50 bg-rose-950/40' },
  { type: 'send_audio', label: 'Send Audio', color: 'border-orange-500/50 bg-orange-950/40' },
  { type: 'delay', label: 'Delay', color: 'border-sky-500/50 bg-sky-950/40' },
  { type: 'condition', label: 'Condition', color: 'border-yellow-500/50 bg-yellow-950/40' },
  { type: 'customer_reply', label: 'Customer Reply', color: 'border-purple-500/50 bg-purple-950/40' },
  { type: 'end', label: 'End', color: 'border-white/30 bg-white/5' },
];

function createDefaultFlow(ownerUid: string): FlowRecord {
  const startId = `node_start_${Date.now()}`;
  const msgId = `node_msg_${Date.now() + 1}`;
  const endId = `node_end_${Date.now() + 2}`;
  return {
    id: `flow_${Date.now().toString(36)}`,
    ownerUid,
    name: 'Welcome Auto-Reply Flow',
    botId: 'all',
    platform: 'all',
    isActive: false,
    triggerKeywords: ['hello', 'hi'],
    nodes: [
      { id: startId, type: 'start', label: 'Start', x: 60, y: 120, config: {} },
      {
        id: msgId,
        type: 'send_message',
        label: 'Send Welcome Reply',
        x: 300,
        y: 120,
        config: { text: 'Welcome! How can our support team assist you today?' },
      },
      { id: endId, type: 'end', label: 'End', x: 560, y: 120, config: {} },
    ],
    edges: [
      { id: `e_${Date.now()}_1`, sourceId: startId, targetId: msgId, branch: 'default' },
      { id: `e_${Date.now()}_2`, sourceId: msgId, targetId: endId, branch: 'default' },
    ],
    executionCount: 0,
    lastExecutedAt: '',
  };
}

export const FlowBuilderPage: React.FC = () => {
  const { workspaceUid, bots, customers, flows, saveFlow, toggleFlowActive, deleteFlow } =
    useStore();

  const [draft, setDraft] = useState<FlowRecord | null>(null);
  const [isNewDraft, setIsNewDraft] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null);
  const [connectBranch, setConnectBranch] = useState<'default' | 'true' | 'false'>(
    'default'
  );
  const [draggingNode, setDraggingNode] = useState<{
    id: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  const [testInput, setTestInput] = useState('hello');
  const [testLive, setTestLive] = useState(false);
  const [testCustomerId, setTestCustomerId] = useState('');
  const [testTrace, setTestTrace] = useState<
    Array<{ nodeId: string; label: string; status: string; detail?: string }>
  >([]);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  const activeFlow = draft || flows[0] || null;
  const selectedNode = useMemo(
    () => activeFlow?.nodes.find((n) => n.id === selectedNodeId) || null,
    [activeFlow, selectedNodeId]
  );

  const selectExistingFlow = (f: FlowRecord) => {
    setDraft(JSON.parse(JSON.stringify(f)) as FlowRecord);
    setIsNewDraft(false);
    setSelectedNodeId(f.nodes[0]?.id || null);
    setConnectSourceId(null);
    setTestTrace([]);
    setStatusMsg(null);
  };

  const handleNewFlow = () => {
    const f = createDefaultFlow(workspaceUid);
    setDraft(f);
    setIsNewDraft(true);
    setSelectedNodeId(f.nodes[0].id);
    setConnectSourceId(null);
    setTestTrace([]);
    setStatusMsg(null);
  };

  const ensureEditableDraft = (): FlowRecord | null => {
    if (draft) return draft;
    if (flows[0]) {
      const cloned = JSON.parse(JSON.stringify(flows[0])) as FlowRecord;
      setDraft(cloned);
      setIsNewDraft(false);
      return cloned;
    }
    return null;
  };

  const updateDraft = (updater: (f: FlowRecord) => FlowRecord) => {
    const base = ensureEditableDraft();
    if (!base) return;
    setDraft(updater(base));
  };

  const handleAddNode = (type: FlowNodeType) => {
    const meta = NODE_PALETTE.find((n) => n.type === type)!;
    updateDraft((f) => {
      const idx = f.nodes.length;
      const newNode: FlowNode = {
        id: `node_${type}_${Date.now().toString(36)}`,
        type,
        label: meta.label,
        x: 80 + (idx % 4) * 210,
        y: 80 + Math.floor(idx / 4) * 140,
        config:
          type === 'delay'
            ? { delaySeconds: 2 }
            : type === 'keyword_trigger'
            ? { keyword: 'help', matchMode: 'contains' }
            : type === 'condition'
            ? { conditionField: 'message_text', conditionOperator: 'contains', conditionValue: 'price' }
            : {},
      };
      setSelectedNodeId(newNode.id);
      return { ...f, nodes: [...f.nodes, newNode] };
    });
  };

  const handleDeleteNode = (nodeId: string) => {
    updateDraft((f) => ({
      ...f,
      nodes: f.nodes.filter((n) => n.id !== nodeId),
      edges: f.edges.filter((e) => e.sourceId !== nodeId && e.targetId !== nodeId),
    }));
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  };

  const handleNodeClick = (node: FlowNode) => {
    if (connectSourceId && connectSourceId !== node.id) {
      updateDraft((f) => {
        const exists = f.edges.some(
          (e) =>
            e.sourceId === connectSourceId &&
            e.targetId === node.id &&
            (e.branch || 'default') === connectBranch
        );
        if (exists) return f;
        const newEdge: FlowEdge = {
          id: `edge_${Date.now().toString(36)}`,
          sourceId: connectSourceId,
          targetId: node.id,
          branch: connectBranch,
        };
        return { ...f, edges: [...f.edges, newEdge] };
      });
      setConnectSourceId(null);
      return;
    }
    setSelectedNodeId(node.id);
  };

  const handleSave = async () => {
    if (!activeFlow) return;
    setSaving(true);
    setStatusMsg(null);
    try {
      const keywords = activeFlow.nodes
        .filter((n) => n.type === 'keyword_trigger' && n.config.keyword)
        .map((n) => n.config.keyword!.trim())
        .filter(Boolean);

      const toSave: FlowRecord = {
        ...activeFlow,
        triggerKeywords: keywords,
      };
      await saveFlow(toSave, isNewDraft);
      setIsNewDraft(false);
      setDraft(toSave);
      setStatusMsg({ type: 'ok', text: `Flow "${toSave.name}" saved & synced.` });
    } catch (err) {
      setStatusMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to save flow',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTestFlow = async () => {
    if (!activeFlow) return;
    setTestTrace([]);
    setStatusMsg(null);
    try {
      const targetCustomer = customers.find((c) => c.id === testCustomerId);
      const res = await authFetch('/api/flows/test', {
        method: 'POST',
        body: JSON.stringify({
          flow: activeFlow,
          sampleText: testInput,
          botId: targetCustomer?.botId || (activeFlow.botId !== 'all' ? activeFlow.botId : undefined),
          platformUserId: targetCustomer?.platformUserId,
          liveSend: testLive && Boolean(targetCustomer),
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        executed?: boolean;
        steps?: Array<{ nodeId: string; label: string; status: string; detail?: string }>;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Flow test failed');
      }
      setTestTrace(json.steps || []);
      if (!json.executed) {
        setStatusMsg({
          type: 'err',
          text: 'No trigger node matched the test input text.',
        });
      }
    } catch (err) {
      setStatusMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Flow test failed',
      });
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Flow Selector & Action Toolbar */}
      <div className="rounded-2xl border border-[#D4AF37]/25 bg-[#140A0D] p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={activeFlow?.id || ''}
            onChange={(e) => {
              const found = flows.find((f) => f.id === e.target.value);
              if (found) selectExistingFlow(found);
            }}
            className="rounded-lg border border-white/10 bg-[#0B0608] px-3 py-2 text-xs text-white focus:border-[#D4AF37] focus:outline-none"
          >
            {flows.length === 0 && !draft && (
              <option value="">No flows saved yet</option>
            )}
            {draft && isNewDraft && (
              <option value={draft.id}>{draft.name} (Unsaved)</option>
            )}
            {flows.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} ({f.isActive ? 'Active' : 'Paused'})
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleNewFlow}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#D4AF37]/40 px-3 py-2 text-xs font-medium text-[#FDE68A] hover:bg-white/5 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            New Flow
          </button>
        </div>

        {activeFlow && (
          <div className="flex flex-wrap items-center gap-2">
            {!isNewDraft && (
              <button
                type="button"
                onClick={() => toggleFlowActive(activeFlow.id, !activeFlow.isActive)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold cursor-pointer ${
                  activeFlow.isActive
                    ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                    : 'border-amber-500/40 bg-amber-950/30 text-amber-300'
                }`}
              >
                <Power className="w-3.5 h-3.5" />
                {activeFlow.isActive ? 'Active' : 'Activate'}
              </button>
            )}

            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#991B1B] to-[#D97706] px-4 py-2 text-xs font-semibold text-white hover:brightness-110 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Saving...' : 'Save Flow'}
            </button>

            {!isNewDraft && (
              <button
                type="button"
                onClick={() => {
                  deleteFlow(activeFlow.id);
                  setDraft(null);
                }}
                aria-label="Delete flow"
                className="p-2 rounded-lg border border-white/10 text-red-400 hover:bg-red-950/40 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {statusMsg && (
        <div
          className={`rounded-xl border px-4 py-2.5 text-xs flex items-center gap-2 ${
            statusMsg.type === 'ok'
              ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200'
              : 'border-red-500/40 bg-red-950/40 text-red-200'
          }`}
        >
          {statusMsg.type === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{statusMsg.text}</span>
        </div>
      )}

      {!activeFlow ? (
        <div className="rounded-2xl border border-dashed border-[#D4AF37]/30 bg-[#140A0D] p-12 text-center space-y-3">
          <GitBranch className="w-10 h-10 text-[#D4AF37]/50 mx-auto" />
          <h3 className="font-display text-base font-semibold text-[#FAF7F2]">
            Create Your First Automation Flow
          </h3>
          <p className="text-xs text-[#9C8B86] max-w-md mx-auto">
            Build real automated conversation flows with Start, Keyword Trigger, Send Message, Image, Audio, Delay, Condition, Customer Reply, and End nodes.
          </p>
          <button
            type="button"
            onClick={handleNewFlow}
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#991B1B] to-[#D97706] px-4 py-2 text-xs font-semibold text-white cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Create Flow
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          {/* Left Palette + Flow Settings */}
          <div className="xl:col-span-3 rounded-2xl border border-[#D4AF37]/25 bg-[#140A0D] p-4 space-y-4">
            <div className="space-y-2">
              <label className="block text-[11px] text-[#9C8B86]">Flow Name</label>
              <input
                type="text"
                value={activeFlow.name}
                onChange={(e) =>
                  updateDraft((f) => ({ ...f, name: e.target.value }))
                }
                className="w-full rounded-lg border border-white/10 bg-[#0B0608] px-3 py-1.5 text-xs text-white"
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={activeFlow.platform}
                  onChange={(e) =>
                    updateDraft((f) => ({
                      ...f,
                      platform: e.target.value as 'all' | Platform,
                    }))
                  }
                  className="rounded-lg border border-white/10 bg-[#0B0608] px-2 py-1.5 text-xs text-white"
                >
                  <option value="all">All Platforms</option>
                  <option value="viber">Viber Only</option>
                  <option value="telegram">Telegram Only</option>
                </select>
                <select
                  value={activeFlow.botId}
                  onChange={(e) =>
                    updateDraft((f) => ({ ...f, botId: e.target.value }))
                  }
                  className="rounded-lg border border-white/10 bg-[#0B0608] px-2 py-1.5 text-xs text-white"
                >
                  <option value="all">All Bots</option>
                  {bots.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="border-t border-white/10 pt-3 space-y-2">
              <p className="text-xs font-semibold text-[#FDE68A]">Add Flow Nodes</p>
              <div className="grid grid-cols-1 gap-1.5">
                {NODE_PALETTE.map((item) => (
                  <button
                    key={item.type}
                    type="button"
                    onClick={() => handleAddNode(item.type)}
                    className={`w-full text-left rounded-lg border px-3 py-2 text-xs text-[#FAF7F2] hover:brightness-125 transition flex items-center justify-between cursor-pointer ${item.color}`}
                  >
                    <span>{item.label}</span>
                    <Plus className="w-3.5 h-3.5 opacity-75" />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Center Interactive Visual Canvas */}
          <div className="xl:col-span-6 rounded-2xl border border-[#D4AF37]/25 bg-[#0B0608] overflow-auto relative min-h-[480px]">
            {connectSourceId && (
              <div className="sticky top-2 left-2 z-20 mx-3 mt-2 rounded-lg border border-[#FDE68A]/50 bg-[#7F1D1D] px-3 py-1.5 text-xs text-white flex items-center justify-between">
                <span>
                  Click a target node to connect ({connectBranch} branch)
                </span>
                <button
                  type="button"
                  onClick={() => setConnectSourceId(null)}
                  className="underline cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            )}

            <div
              className="relative w-[960px] h-[540px]"
              onPointerMove={(e) => {
                if (!draggingNode) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const nx = Math.max(10, Math.min(780, e.clientX - rect.left - draggingNode.offsetX));
                const ny = Math.max(10, Math.min(460, e.clientY - rect.top - draggingNode.offsetY));
                updateDraft((f) => ({
                  ...f,
                  nodes: f.nodes.map((n) =>
                    n.id === draggingNode.id ? { ...n, x: nx, y: ny } : n
                  ),
                }));
              }}
              onPointerUp={() => setDraggingNode(null)}
            >
              {/* SVG Edges */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none">
                {activeFlow.edges.map((edge) => {
                  const src = activeFlow.nodes.find((n) => n.id === edge.sourceId);
                  const tgt = activeFlow.nodes.find((n) => n.id === edge.targetId);
                  if (!src || !tgt) return null;
                  const x1 = src.x + 170;
                  const y1 = src.y + 34;
                  const x2 = tgt.x;
                  const y2 = tgt.y + 34;
                  const cx1 = x1 + Math.max(40, (x2 - x1) / 2);
                  const cx2 = x2 - Math.max(40, (x2 - x1) / 2);
                  const stroke =
                    edge.branch === 'true'
                      ? '#34D399'
                      : edge.branch === 'false'
                      ? '#F87171'
                      : '#D4AF37';
                  return (
                    <g key={edge.id}>
                      <path
                        d={`M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`}
                        fill="none"
                        stroke={stroke}
                        strokeWidth={2}
                        strokeOpacity={0.75}
                      />
                      {edge.branch && edge.branch !== 'default' && (
                        <text
                          x={(x1 + x2) / 2}
                          y={(y1 + y2) / 2 - 6}
                          fill={stroke}
                          fontSize={10}
                          fontWeight="bold"
                        >
                          {edge.branch.toUpperCase()}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>

              {/* Draggable Nodes */}
              {activeFlow.nodes.map((node) => {
                const palette = NODE_PALETTE.find((p) => p.type === node.type);
                const isSelected = node.id === selectedNodeId;
                return (
                  <div
                    key={node.id}
                    style={{ left: node.x, top: node.y }}
                    onClick={() => handleNodeClick(node)}
                    onPointerDown={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setDraggingNode({
                        id: node.id,
                        offsetX: e.clientX - rect.left,
                        offsetY: e.clientY - rect.top,
                      });
                    }}
                    className={`absolute w-[170px] rounded-xl border p-2.5 select-none cursor-grab active:cursor-grabbing transition ${
                      palette?.color || 'border-white/20 bg-[#140A0D]'
                    } ${isSelected ? 'ring-2 ring-[#FDE68A]' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] uppercase tracking-wider text-[#FDE68A]/80">
                        {node.type.replace('_', ' ')}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConnectSourceId(node.id);
                          setConnectBranch('default');
                        }}
                        title="Connect to another node"
                        className="text-[#D4AF37] hover:text-white cursor-pointer"
                      >
                        <Link2 className="w-3 h-3" />
                      </button>
                    </div>
                    <p className="text-xs font-semibold text-white truncate mt-1">
                      {node.label}
                    </p>
                    {node.config.text && (
                      <p className="text-[10px] text-[#D6C7C2] truncate mt-0.5">
                        {node.config.text}
                      </p>
                    )}
                    {node.config.keyword && (
                      <p className="text-[10px] text-[#FDE68A] truncate mt-0.5">
                        Key: {node.config.keyword}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Node Inspector & Flow Tester */}
          <div className="xl:col-span-3 space-y-4">
            <div className="rounded-2xl border border-[#D4AF37]/25 bg-[#140A0D] p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <h3 className="text-xs font-semibold text-[#FDE68A]">Node Inspector</h3>
                {selectedNode && (
                  <button
                    type="button"
                    onClick={() => handleDeleteNode(selectedNode.id)}
                    className="text-red-400 hover:text-red-300 text-xs cursor-pointer"
                  >
                    Delete Node
                  </button>
                )}
              </div>

              {!selectedNode ? (
                <p className="text-xs text-[#9C8B86]">Click a node on the canvas to edit.</p>
              ) : (
                <div className="space-y-3 text-xs">
                  <div>
                    <label className="block text-[#9C8B86] mb-1">Label</label>
                    <input
                      type="text"
                      value={selectedNode.label}
                      onChange={(e) =>
                        updateDraft((f) => ({
                          ...f,
                          nodes: f.nodes.map((n) =>
                            n.id === selectedNode.id ? { ...n, label: e.target.value } : n
                          ),
                        }))
                      }
                      className="w-full rounded border border-white/10 bg-[#0B0608] px-2.5 py-1.5 text-white"
                    />
                  </div>

                  {(selectedNode.type === 'send_message' ||
                    selectedNode.type === 'send_image' ||
                    selectedNode.type === 'send_audio') && (
                    <div>
                      <label className="block text-[#9C8B86] mb-1">Message / Caption</label>
                      <textarea
                        rows={3}
                        value={selectedNode.config.text || ''}
                        onChange={(e) =>
                          updateDraft((f) => ({
                            ...f,
                            nodes: f.nodes.map((n) =>
                              n.id === selectedNode.id
                                ? { ...n, config: { ...n.config, text: e.target.value } }
                                : n
                            ),
                          }))
                        }
                        className="w-full rounded border border-white/10 bg-[#0B0608] px-2.5 py-1.5 text-white"
                      />
                    </div>
                  )}

                  {(selectedNode.type === 'send_image' ||
                    selectedNode.type === 'send_audio') && (
                    <div>
                      <label className="block text-[#9C8B86] mb-1">Media HTTPS URL</label>
                      <input
                        type="url"
                        value={selectedNode.config.mediaUrl || ''}
                        onChange={(e) =>
                          updateDraft((f) => ({
                            ...f,
                            nodes: f.nodes.map((n) =>
                              n.id === selectedNode.id
                                ? { ...n, config: { ...n.config, mediaUrl: e.target.value } }
                                : n
                            ),
                          }))
                        }
                        placeholder="https://..."
                        className="w-full rounded border border-white/10 bg-[#0B0608] px-2.5 py-1.5 text-white"
                      />
                    </div>
                  )}

                  {selectedNode.type === 'delay' && (
                    <div>
                      <label className="block text-[#9C8B86] mb-1">Delay (seconds, max 15)</label>
                      <input
                        type="number"
                        min={1}
                        max={15}
                        value={selectedNode.config.delaySeconds || 2}
                        onChange={(e) =>
                          updateDraft((f) => ({
                            ...f,
                            nodes: f.nodes.map((n) =>
                              n.id === selectedNode.id
                                ? {
                                    ...n,
                                    config: { ...n.config, delaySeconds: Number(e.target.value) },
                                  }
                                : n
                            ),
                          }))
                        }
                        className="w-full rounded border border-white/10 bg-[#0B0608] px-2.5 py-1.5 text-white"
                      />
                    </div>
                  )}

                  {selectedNode.type === 'keyword_trigger' && (
                    <>
                      <div>
                        <label className="block text-[#9C8B86] mb-1">Keyword</label>
                        <input
                          type="text"
                          value={selectedNode.config.keyword || ''}
                          onChange={(e) =>
                            updateDraft((f) => ({
                              ...f,
                              nodes: f.nodes.map((n) =>
                                n.id === selectedNode.id
                                  ? { ...n, config: { ...n.config, keyword: e.target.value } }
                                  : n
                              ),
                            }))
                          }
                          className="w-full rounded border border-white/10 bg-[#0B0608] px-2.5 py-1.5 text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[#9C8B86] mb-1">Match Mode</label>
                        <select
                          value={selectedNode.config.matchMode || 'contains'}
                          onChange={(e) =>
                            updateDraft((f) => ({
                              ...f,
                              nodes: f.nodes.map((n) =>
                                n.id === selectedNode.id
                                  ? {
                                      ...n,
                                      config: {
                                        ...n.config,
                                        matchMode: e.target.value as 'contains' | 'exact' | 'starts_with',
                                      },
                                    }
                                  : n
                              ),
                            }))
                          }
                          className="w-full rounded border border-white/10 bg-[#0B0608] px-2.5 py-1.5 text-white"
                        >
                          <option value="contains">Contains</option>
                          <option value="exact">Exact Match</option>
                          <option value="starts_with">Starts With</option>
                        </select>
                      </div>
                    </>
                  )}

                  {selectedNode.type === 'condition' && (
                    <div className="space-y-2">
                      <label className="block text-[#9C8B86]">Condition Value (Contains)</label>
                      <input
                        type="text"
                        value={selectedNode.config.conditionValue || ''}
                        onChange={(e) =>
                          updateDraft((f) => ({
                            ...f,
                            nodes: f.nodes.map((n) =>
                              n.id === selectedNode.id
                                ? {
                                    ...n,
                                    config: { ...n.config, conditionValue: e.target.value },
                                  }
                                : n
                            ),
                          }))
                        }
                        className="w-full rounded border border-white/10 bg-[#0B0608] px-2.5 py-1.5 text-white"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setConnectSourceId(selectedNode.id);
                            setConnectBranch('true');
                          }}
                          className="flex-1 rounded border border-emerald-500/40 py-1 text-[11px] text-emerald-300 cursor-pointer"
                        >
                          Link TRUE
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setConnectSourceId(selectedNode.id);
                            setConnectBranch('false');
                          }}
                          className="flex-1 rounded border border-red-500/40 py-1 text-[11px] text-red-300 cursor-pointer"
                        >
                          Link FALSE
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Outgoing Connections List */}
                  <div className="border-t border-white/10 pt-2 space-y-1">
                    <p className="text-[11px] text-[#9C8B86]">Outgoing Links</p>
                    {activeFlow.edges
                      .filter((e) => e.sourceId === selectedNode.id)
                      .map((edge) => {
                        const tgt = activeFlow.nodes.find((n) => n.id === edge.targetId);
                        return (
                          <div
                            key={edge.id}
                            className="flex items-center justify-between text-[11px] bg-[#0B0608] px-2 py-1 rounded"
                          >
                            <span className="truncate">
                              → {tgt?.label || edge.targetId} ({edge.branch || 'default'})
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                updateDraft((f) => ({
                                  ...f,
                                  edges: f.edges.filter((x) => x.id !== edge.id),
                                }))
                              }
                              className="text-red-400 ml-2 cursor-pointer"
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>

            {/* Flow Tester */}
            <div className="rounded-2xl border border-[#D4AF37]/25 bg-[#140A0D] p-4 space-y-3 text-xs">
              <h3 className="font-semibold text-[#FDE68A]">Test Flow</h3>
              <input
                type="text"
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                placeholder="Sample incoming customer message..."
                className="w-full rounded border border-white/10 bg-[#0B0608] px-2.5 py-1.5 text-white"
              />
              {customers.length > 0 && (
                <>
                  <label className="flex items-center gap-2 text-[#C7B7B2] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={testLive}
                      onChange={(e) => setTestLive(e.target.checked)}
                      className="accent-[#D4AF37]"
                    />
                    <span>Send real test message to customer</span>
                  </label>
                  {testLive && (
                    <select
                      value={testCustomerId}
                      onChange={(e) => setTestCustomerId(e.target.value)}
                      className="w-full rounded border border-white/10 bg-[#0B0608] px-2 py-1.5 text-white"
                    >
                      <option value="">Select real customer...</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.displayName} ({c.platform})
                        </option>
                      ))}
                    </select>
                  )}
                </>
              )}
              <button
                type="button"
                onClick={handleTestFlow}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#D4AF37]/40 py-2 font-semibold text-[#FDE68A] hover:bg-white/5 cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                Run Flow Test
              </button>

              {testTrace.length > 0 && (
                <div className="space-y-1 border-t border-white/10 pt-2">
                  {testTrace.map((step, i) => (
                    <div key={`${step.nodeId}_${i}`} className="text-[11px] text-[#D6C7C2]">
                      <span className="text-[#FDE68A]">{i + 1}.</span> {step.label} —{' '}
                      <span
                        className={
                          step.status === 'executed' ? 'text-emerald-400' : 'text-amber-400'
                        }
                      >
                        {step.detail || step.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
