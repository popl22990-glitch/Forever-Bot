import React, { useState } from 'react';
import {
  LayoutDashboard,
  MessageSquare,
  Send,
  Bot,
  Sliders,
  GitBranch,
  Users,
  Bell,
  Settings,
  Volume2,
  VolumeX,
  Menu,
  X,
} from 'lucide-react';
import { StoreProvider, useStore } from './context/StoreContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DashboardPage } from './pages/DashboardPage';
import { InboxPage } from './pages/InboxPage';
import { BroadcastPage } from './pages/BroadcastPage';
import { BotManagementPage } from './pages/BotManagementPage';
import { ChannelSettingsPage } from './pages/ChannelSettingsPage';
import { FlowBuilderPage } from './pages/FlowBuilderPage';
import { CustomersPage } from './pages/CustomersPage';
import { NotificationSettingsPage } from './pages/NotificationSettingsPage';
import { GeneralSettingsPage } from './pages/GeneralSettingsPage';
import type { NavSection } from './types';

const NAV_ITEMS: Array<{ id: NavSection; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'inbox', label: 'Inbox', icon: MessageSquare },
  { id: 'broadcast', label: 'Broadcast', icon: Send },
  { id: 'bots', label: 'Bot Management', icon: Bot },
  { id: 'channels', label: 'Channel Settings', icon: Sliders },
  { id: 'flows', label: 'Flow Builder', icon: GitBranch },
  { id: 'customers', label: 'Customers', icon: Users },
  { id: 'notifications', label: 'Notification Settings', icon: Bell },
  { id: 'settings', label: 'General Settings', icon: Settings },
];

const AppShell: React.FC = () => {
  const {
    customers,
    audioUnlocked,
    unlockAudio,
    settings,
    wsConnected,
  } = useStore();

  const [activeNav, setActiveNav] = useState<NavSection>('dashboard');
  const [inboxCustomerId, setInboxCustomerId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const totalUnread = customers.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

  const navigateTo = (section: NavSection, customerId?: string) => {
    if (customerId) {
      setInboxCustomerId(customerId);
    }
    setActiveNav(section);
    setMobileMenuOpen(false);
  };

  const activeNavMeta = NAV_ITEMS.find((n) => n.id === activeNav)!;

  return (
    <div className="min-h-screen bg-[#0B0608] text-[#FAF7F2] flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col border-r border-[#D4AF37]/20 bg-[#11080B] shrink-0">
        <div className="h-16 px-5 flex items-center gap-3 border-b border-[#D4AF37]/20">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-[#991B1B] to-[#D4AF37] flex items-center justify-center font-display font-bold text-sm text-white shrink-0">
            FB
          </div>
          <span className="font-display text-base font-bold tracking-tight bg-gradient-to-r from-[#FAF7F2] via-[#FDE68A] to-[#D4AF37] bg-clip-text text-transparent whitespace-nowrap">
            {settings.platformName || 'FOREVER BOT'}
          </span>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigateTo(item.id)}
                className={`w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-medium transition cursor-pointer ${
                  active
                    ? 'bg-gradient-to-r from-[#991B1B] to-[#B45309] text-white'
                    : 'text-[#C7B7B2] hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.id === 'inbox' && totalUnread > 0 && (
                  <span className="font-mono text-[11px] font-bold text-[#FDE68A] tabular-nums">
                    {totalUnread}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/10 text-xs">
          <p className="text-[#FAF7F2] font-medium truncate">FOREVER BOT Admin</p>
          <p className="text-[11px] text-[#9C8B86] mt-0.5">
            {wsConnected ? 'Live Sync Connected' : 'Sync Reconnecting'}
          </p>
        </div>
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/75"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative w-72 max-w-[85vw] bg-[#11080B] border-r border-[#D4AF37]/25 flex flex-col h-full z-10">
            <div className="h-14 px-4 flex items-center justify-between border-b border-white/10">
              <span className="font-display text-base font-bold text-[#FDE68A]">
                {settings.platformName || 'FOREVER BOT'}
              </span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 text-[#C7B7B2]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeNav === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigateTo(item.id)}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-medium ${
                      active
                        ? 'bg-gradient-to-r from-[#991B1B] to-[#B45309] text-white'
                        : 'text-[#C7B7B2]'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon className="w-4 h-4" />
                      <span>{item.label}</span>
                    </span>
                    {item.id === 'inbox' && totalUnread > 0 && (
                      <span className="font-mono text-[#FDE68A] tabular-nums">
                        {totalUnread}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 lg:h-16 px-4 sm:px-6 border-b border-[#D4AF37]/20 bg-[#11080B]/95 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open menu"
              className="lg:hidden p-2 rounded-lg border border-white/10 text-[#FDE68A]"
            >
              <Menu className="w-4 h-4" />
            </button>
            <h1 className="font-display text-base sm:text-lg font-semibold text-[#FAF7F2] truncate">
              {activeNavMeta.label}
            </h1>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={unlockAudio}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition cursor-pointer whitespace-nowrap ${
                audioUnlocked && settings.soundEnabled
                  ? 'border border-[#D4AF37]/30 bg-[#1B0D12] text-[#FDE68A]'
                  : 'bg-gradient-to-r from-[#991B1B] to-[#D97706] text-white'
              }`}
            >
              {settings.soundEnabled ? (
                <Volume2 className="w-3.5 h-3.5" />
              ) : (
                <VolumeX className="w-3.5 h-3.5" />
              )}
              <span>
                {!settings.soundEnabled
                  ? 'Sound Off'
                  : audioUnlocked
                  ? 'Alerts Active'
                  : 'Enable Sound'}
              </span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 overflow-y-auto">
          {activeNav === 'dashboard' && <DashboardPage onNavigate={navigateTo} />}
          {activeNav === 'inbox' && <InboxPage initialCustomerId={inboxCustomerId} />}
          {activeNav === 'broadcast' && <BroadcastPage />}
          {activeNav === 'bots' && <BotManagementPage />}
          {activeNav === 'channels' && <ChannelSettingsPage />}
          {activeNav === 'flows' && <FlowBuilderPage />}
          {activeNav === 'customers' && <CustomersPage onNavigate={navigateTo} />}
          {activeNav === 'notifications' && <NotificationSettingsPage />}
          {activeNav === 'settings' && <GeneralSettingsPage />}
        </main>
      </div>
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <StoreProvider>
        <AppShell />
      </StoreProvider>
    </ErrorBoundary>
  );
}
