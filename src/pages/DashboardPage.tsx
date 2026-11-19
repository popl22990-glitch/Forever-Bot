import React from 'react';
import {
  Users,
  MessageSquare,
  MailWarning,
  Bot,
  Send,
  Activity,
  ArrowUpRight,
  Radio,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { BannerSlider } from '../components/BannerSlider';
import type { NavSection } from '../types';

interface DashboardPageProps {
  onNavigate: (section: NavSection, customerId?: string) => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ onNavigate }) => {
  const { bots, customers, messages, broadcasts, flows, wsConnected } = useStore();

  const connectedBots = bots.filter((b) => b.status === 'connected');
  const viberBots = bots.filter((b) => b.platform === 'viber');
  const telegramBots = bots.filter((b) => b.platform === 'telegram');

  const totalUnread = customers.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
  const totalBroadcastSent = broadcasts.reduce((sum, b) => sum + (b.successCount || 0), 0);
  const totalBroadcastFailed = broadcasts.reduce((sum, b) => sum + (b.failedCount || 0), 0);
  const activeFlowsCount = flows.filter((f) => f.isActive).length;

  const recentCustomers = customers.slice(0, 6);
  const recentBroadcasts = broadcasts.slice(0, 4);

  const stats = [
    {
      label: 'Total Customers',
      value: customers.length,
      sub: `${customers.filter((c) => c.platform === 'viber').length} Viber · ${
        customers.filter((c) => c.platform === 'telegram').length
      } Telegram`,
      icon: Users,
      onClick: () => onNavigate('customers'),
    },
    {
      label: 'Total Messages',
      value: messages.length,
      sub: `${messages.filter((m) => m.direction === 'incoming').length} incoming · ${
        messages.filter((m) => m.direction === 'outgoing').length
      } outgoing`,
      icon: MessageSquare,
      onClick: () => onNavigate('inbox'),
    },
    {
      label: 'Unread Messages',
      value: totalUnread,
      sub: totalUnread > 0 ? 'Requires agent response' : 'All conversations caught up',
      icon: MailWarning,
      onClick: () => onNavigate('inbox'),
    },
    {
      label: 'Connected Bots',
      value: `${connectedBots.length} / 4`,
      sub: `${viberBots.length}/2 Viber · ${telegramBots.length}/2 Telegram`,
      icon: Bot,
      onClick: () => onNavigate('bots'),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Three Promotional Burmese Slider Banners */}
      <BannerSlider onNavigate={onNavigate} />

      {/* Core Database KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <button
              key={stat.label}
              type="button"
              onClick={stat.onClick}
              className="text-left rounded-xl border border-[#D4AF37]/20 bg-[#140A0D] p-5 hover:border-[#D4AF37]/50 transition group cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[#B8A8A3]">{stat.label}</span>
                <Icon className="w-4 h-4 text-[#D4AF37] group-hover:text-[#FDE68A] transition" />
              </div>
              <div className="mt-2 font-display text-2xl sm:text-3xl font-bold text-[#FAF7F2] tabular-nums">
                {stat.value}
              </div>
              <div className="mt-1.5 text-xs text-[#9C8B86] tabular-nums">{stat.sub}</div>
            </button>
          );
        })}
      </div>

      {/* Broadcast Stats + Online Status + Active Flows */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-xl border border-[#D4AF37]/20 bg-[#140A0D] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-semibold text-[#FAF7F2]">
              Broadcast Statistics
            </h3>
            <Send className="w-4 h-4 text-[#EF4444]" />
          </div>
          <div className="grid grid-cols-3 gap-3 border-t border-white/10 pt-4">
            <div>
              <p className="text-xs text-[#9C8B86]">Campaigns</p>
              <p className="mt-1 text-xl font-bold text-[#FAF7F2] tabular-nums">
                {broadcasts.length}
              </p>
            </div>
            <div>
              <p className="text-xs text-[#9C8B86]">Delivered</p>
              <p className="mt-1 text-xl font-bold text-emerald-400 tabular-nums">
                {totalBroadcastSent}
              </p>
            </div>
            <div>
              <p className="text-xs text-[#9C8B86]">Failed</p>
              <p className="mt-1 text-xl font-bold text-red-400 tabular-nums">
                {totalBroadcastFailed}
              </p>
            </div>
          </div>
          <div className="pt-2">
            {recentBroadcasts.length === 0 ? (
              <p className="text-xs text-[#9C8B86]">
                No broadcasts sent yet. Select eligible customers in Broadcast to launch a campaign.
              </p>
            ) : (
              <div className="space-y-2">
                {recentBroadcasts.map((bc) => (
                  <div
                    key={bc.id}
                    className="flex items-center justify-between text-xs border-b border-white/5 pb-2 last:border-b-0"
                  >
                    <span className="text-[#FAF7F2] truncate max-w-[170px]">{bc.title}</span>
                    <span className="text-[#B8A8A3] tabular-nums">
                      {bc.successCount}/{bc.totalTargets} · {bc.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-[#D4AF37]/20 bg-[#140A0D] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-semibold text-[#FAF7F2]">
              Online & Channel Status
            </h3>
            <Radio className="w-4 h-4 text-[#D4AF37]" />
          </div>
          <div className="space-y-3 border-t border-white/10 pt-4 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[#B8A8A3]">Real-Time Sync Socket</span>
              <span className={wsConnected ? 'text-emerald-400 font-medium' : 'text-amber-400 font-medium'}>
                {wsConnected ? 'Connected' : 'Reconnecting'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#B8A8A3]">Active Automation Flows</span>
              <span className="text-[#FAF7F2] font-medium tabular-nums">
                {activeFlowsCount} / {flows.length}
              </span>
            </div>
            <div className="pt-1 space-y-2">
              {bots.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[#D4AF37]/25 p-3 text-[#9C8B86]">
                  No bots connected yet.{' '}
                  <button
                    type="button"
                    onClick={() => onNavigate('bots')}
                    className="text-[#FDE68A] underline hover:text-white cursor-pointer"
                  >
                    Add Viber or Telegram bot
                  </button>
                </div>
              ) : (
                bots.map((bot) => (
                  <div
                    key={bot.id}
                    className="flex items-center justify-between border-b border-white/5 pb-2 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="text-[#FAF7F2] font-medium truncate">{bot.name}</p>
                      <p className="text-[11px] text-[#9C8B86]">
                        {bot.platform === 'viber' ? 'Viber' : 'Telegram'} · {bot.syncMode || 'webhook'}
                      </p>
                    </div>
                    <span
                      className={`text-[11px] font-medium ${
                        bot.status === 'connected'
                          ? 'text-emerald-400'
                          : bot.status === 'error'
                          ? 'text-red-400'
                          : 'text-amber-400'
                      }`}
                    >
                      {bot.status === 'connected'
                        ? 'Online'
                        : bot.status === 'awaiting_config'
                        ? 'Awaiting Config'
                        : bot.status}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[#D4AF37]/20 bg-[#140A0D] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-semibold text-[#FAF7F2]">
              Recent Customer Activity
            </h3>
            <Activity className="w-4 h-4 text-[#FDE68A]" />
          </div>
          <div className="border-t border-white/10 pt-3">
            {recentCustomers.length === 0 ? (
              <div className="py-6 text-center space-y-2">
                <p className="text-xs text-[#9C8B86]">
                  Waiting for real customer interactions from your connected Viber or Telegram bots.
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate('channels')}
                  className="inline-flex items-center gap-1.5 text-xs text-[#FDE68A] hover:underline cursor-pointer"
                >
                  Configure Channels <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {recentCustomers.map((cust) => (
                  <button
                    key={cust.id}
                    type="button"
                    onClick={() => onNavigate('inbox', cust.id)}
                    className="w-full py-2.5 flex items-center justify-between gap-3 text-left hover:bg-white/[0.03] rounded-lg px-2 transition cursor-pointer"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-[#FAF7F2] truncate">
                        {cust.displayName}
                      </p>
                      <p className="text-[11px] text-[#9C8B86] truncate">
                        {cust.platform === 'viber' ? 'Viber' : 'Telegram'} ·{' '}
                        {cust.lastMessageText || 'No messages'}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      {cust.unreadCount > 0 && (
                        <span className="text-xs font-semibold text-[#F59E0B] tabular-nums">
                          {cust.unreadCount} new
                        </span>
                      )}
                      {cust.lastMessageAt && (
                        <p className="text-[11px] text-[#7D6C67] font-mono tabular-nums">
                          {new Date(cust.lastMessageAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
