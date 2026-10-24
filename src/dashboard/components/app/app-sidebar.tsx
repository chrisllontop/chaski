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
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '~/components/ui/sidebar';
import { api } from '~/lib/api';
import type { Actor } from '~/lib/types';
import { LogoMark } from './logo';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/deliveries', label: 'Deliveries', icon: Send },
  { to: '/templates', label: 'Templates', icon: FileText },
  { to: '/schedules', label: 'Schedules', icon: CalendarClock },
  { to: '/channels', label: 'Channels', icon: Radio },
] as const;

// The actor is { id, name? }: Cloudflare Access gives the email for both, and
// basic auth only the username.
const ActorBadge = () => {
  const { data } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<{ actor: Actor | null }>('me'),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const label = data?.actor ? (data.actor.name ?? data.actor.id) : null;
  if (!label) return null;
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 text-sm">
      <Avatar className="size-8 rounded-lg">
        <AvatarFallback className="rounded-lg">{label.slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>
      <span className="truncate font-medium">{label}</span>
    </div>
  );
};

export const AppSidebar = () => (
  <Sidebar collapsible="icon">
    <SidebarHeader>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" asChild>
            <Link to="/">
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <LogoMark className="size-5" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">Chaski</span>
                <span className="truncate text-muted-foreground text-xs">Notifications</span>
              </div>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            {NAV.map(({ to, label, icon: Icon }) => (
              <SidebarMenuItem key={to}>
                <SidebarMenuButton asChild tooltip={label}>
                  <Link
                    to={to}
                    activeOptions={{ exact: to === '/' }}
                    activeProps={{ 'data-active': true }}
                  >
                    <Icon />
                    <span>{label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>
    <SidebarFooter>
      <ActorBadge />
    </SidebarFooter>
    <SidebarRail />
  </Sidebar>
);
