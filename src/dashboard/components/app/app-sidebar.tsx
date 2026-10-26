import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CalendarClock, FileText, LayoutDashboard, Radio, Send } from 'lucide-react';
import { Avatar, AvatarFallback } from '~/components/ui/avatar';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '~/components/ui/sidebar';
import { api } from '~/lib/api';
import { formatNumber } from '~/lib/format';
import type { Actor, Overview } from '~/lib/types';
import { LogoMark } from './logo';

type Badge = 'failures' | 'scheduled';

const GROUPS = [
  {
    label: 'Monitor',
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboard },
      { to: '/deliveries', label: 'Deliveries', icon: Send, badge: 'failures' as Badge },
      { to: '/schedules', label: 'Schedules', icon: CalendarClock, badge: 'scheduled' as Badge },
    ],
  },
  {
    label: 'Configure',
    items: [
      { to: '/templates', label: 'Templates', icon: FileText },
      { to: '/channels', label: 'Channels', icon: Radio },
    ],
  },
] as const;

// The actor is { id, name? }: Cloudflare Access gives the email for both, and
// basic auth only the username.
const ActorBadge = () => {
  const { data } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<{ actor: Actor | null }>('me'),
    staleTime: Number.POSITIVE_INFINITY,
  });
  if (!data?.actor) return null;
  const { id, name } = data.actor;
  const label = name ?? id;
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm group-data-[collapsible=icon]:p-0">
      <Avatar className="size-7 rounded-md">
        <AvatarFallback className="rounded-md text-xs">
          {label.slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="grid min-w-0 leading-tight group-data-[collapsible=icon]:hidden">
        <span className="truncate font-medium">{label}</span>
        {name && name !== id ? (
          <span className="truncate text-muted-foreground text-xs">{id}</span>
        ) : null}
      </div>
    </div>
  );
};

// Same key as the overview's default period, so the badges cost no extra request there.
const useBadges = (): Record<Badge, number> => {
  const { data } = useQuery({
    queryKey: ['metrics', 'overview', '30d'],
    queryFn: () => api.get<Overview>('metrics/overview?period=30d'),
  });
  return {
    failures: (data?.failed ?? 0) + (data?.dead ?? 0),
    scheduled: data?.scheduledPending ?? 0,
  };
};

export const AppSidebar = () => {
  const badges = useBadges();
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/">
                <div className="flex aspect-square size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <LogoMark className="size-5" />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-semibold text-sm tracking-tight">Chaski</span>
                  <span className="truncate text-muted-foreground text-xs">Notifications</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const count = 'badge' in item ? badges[item.badge] : 0;
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild tooltip={item.label}>
                        <Link
                          to={item.to}
                          activeOptions={{ exact: item.to === '/' }}
                          activeProps={{ 'data-active': true }}
                        >
                          <Icon />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                      {count > 0 ? (
                        <SidebarMenuBadge
                          className={
                            'badge' in item && item.badge === 'failures'
                              ? 'text-destructive peer-hover/menu-button:text-destructive'
                              : 'text-muted-foreground'
                          }
                        >
                          {formatNumber(count)}
                        </SidebarMenuBadge>
                      ) : null}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <ActorBadge />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
};
