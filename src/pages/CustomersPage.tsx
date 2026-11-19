import React, { useMemo, useState } from 'react';
import {
  Search,
  Edit3,
  Check,
  X,
  MessageSquare,
  Users,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import type { NavSection, Platform } from '../types';

interface CustomersPageProps {
  onNavigate: (section: NavSection, customerId?: string) => void;
}

export const CustomersPage: React.FC<CustomersPageProps> = ({ onNavigate }) => {
  const { bots, customers, renameCustomer } = useStore();

  const [search, setSearch] = useState('');
  const [platformFilter, setPlatformFilter] = useState<'all' | Platform>('all');
  const [botFilter, setBotFilter] = useState('all');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers.filter((c) => {
      if (platformFilter !== 'all' && c.platform !== platformFilter) return false;
      if (botFilter !== 'all' && c.botId !== botFilter) return false;
      if (!q) return true;
      return (
        c.displayName.toLowerCase().includes(q) ||
        (c.platformName || '').toLowerCase().includes(q) ||
        c.platformUserId.toLowerCase().includes(q) ||
        (c.username || '').toLowerCase().includes(q)
      );
    });
  }, [customers, search, platformFilter, botFilter]);

  const handleSaveName = async (customerId: string) => {
    if (!draftName.trim()) return;
    await renameCustomer(customerId, draftName.trim());
    setEditingId(null);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[#D4AF37]/25 bg-[#140A0D] p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-[#FAF7F2]">
            Customer Directory ({customers.length})
          </h2>
          <p className="text-xs text-[#9C8B86]">
            Real Viber and Telegram customers persisted permanently. Display names can be customized without altering original platform IDs.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-[#9C8B86] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or platform ID..."
              className="rounded-lg border border-white/10 bg-[#0B0608] pl-9 pr-3 py-2 text-xs text-white placeholder-[#7D6C67] focus:border-[#D4AF37] focus:outline-none"
            />
          </div>

          <select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value as 'all' | Platform)}
            className="rounded-lg border border-white/10 bg-[#0B0608] px-3 py-2 text-xs text-white"
          >
            <option value="all">All Platforms</option>
            <option value="viber">Viber</option>
            <option value="telegram">Telegram</option>
          </select>

          <select
            value={botFilter}
            onChange={(e) => setBotFilter(e.target.value)}
            className="rounded-lg border border-white/10 bg-[#0B0608] px-3 py-2 text-xs text-white"
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

      <div className="rounded-2xl border border-[#D4AF37]/25 bg-[#140A0D] overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <Users className="w-9 h-9 text-[#D4AF37]/40 mx-auto" />
            <p className="text-sm font-medium text-[#FAF7F2]">No customer records found</p>
            <p className="text-xs text-[#9C8B86]">
              Real customers appear automatically when users contact or subscribe to your connected Viber or Telegram bots.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/10 text-[#9C8B86] bg-[#0F0709]">
                  <th className="py-3 px-4 font-medium">Display Name</th>
                  <th className="py-3 px-4 font-medium">Original Platform ID</th>
                  <th className="py-3 px-4 font-medium">Platform & Bot</th>
                  <th className="py-3 px-4 font-medium">Last Message</th>
                  <th className="py-3 px-4 font-medium">First Contact</th>
                  <th className="py-3 px-4 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filtered.map((cust) => {
                  const bot = bots.find((b) => b.id === cust.botId);
                  const isEditing = editingId === cust.id;

                  return (
                    <tr key={cust.id} className="hover:bg-white/[0.02]">
                      <td className="py-3 px-4">
                        {isEditing ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={draftName}
                              onChange={(e) => setDraftName(e.target.value)}
                              className="rounded border border-[#D4AF37]/60 bg-[#0B0608] px-2 py-1 text-xs text-white"
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveName(cust.id)}
                              className="p-1 rounded bg-emerald-700 text-white cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="p-1 rounded bg-white/10 text-white cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-[#FAF7F2]">
                              {cust.displayName}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(cust.id);
                                setDraftName(cust.displayName);
                              }}
                              title="Edit customer display name"
                              className="text-[#D4AF37] hover:text-[#FDE68A] cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                        {cust.platformName && cust.platformName !== cust.displayName && (
                          <p className="text-[11px] text-[#7D6C67]">
                            Original: {cust.platformName}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-[#C7B7B2] tabular-nums">
                        {cust.platformUserId}
                      </td>
                      <td className="py-3 px-4 text-[#C7B7B2]">
                        {cust.platform === 'viber' ? 'Viber' : 'Telegram'} ·{' '}
                        {bot?.name || cust.botId}
                      </td>
                      <td className="py-3 px-4 text-[#D6C7C2] max-w-xs truncate">
                        {cust.lastMessageText || '—'}
                      </td>
                      <td className="py-3 px-4 font-mono text-[#9C8B86] tabular-nums">
                        {cust.firstContactAt
                          ? new Date(cust.firstContactAt).toLocaleDateString()
                          : '—'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => onNavigate('inbox', cust.id)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#D4AF37]/35 px-3 py-1.5 text-xs text-[#FDE68A] hover:bg-white/5 cursor-pointer"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          Open Chat
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
