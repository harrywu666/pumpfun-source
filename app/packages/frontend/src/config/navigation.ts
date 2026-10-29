import type { ComponentType } from "react";
import {
  type IconProps,
  NavExploreActiveIcon,
  NavExploreIcon,
  NavGoActiveIcon,
  NavGoIcon,
  NavHolderRewardsActiveIcon,
  NavHolderRewardsIcon,
  NavHomeIcon,
  NavLeaderboardActiveIcon,
  NavLeaderboardIcon,
  NavLiveActiveIcon,
  NavLiveIcon,
  NavMayhemActiveIcon,
  NavMayhemIcon,
  NavPerpsActiveIcon,
  NavPerpsIcon,
  NavPumpTokenIcon,
  InfoBarPositionsIcon,
  TikTokIcon,
  XIcon,
  YouTubeIcon,
} from "@/components/shell/captured-icons";

export type Icon = ComponentType<IconProps>;

export interface NavLink {
  label: string;
  href: string;
  icon: Icon;
  /** Icon rendered while the route is active, where the capture has a distinct one. */
  activeIcon?: Icon;
  badge?: "New";
  disabledReason?: string;
}

/** A menu entry. Entries without `href` are shown disabled, with the reason as a tooltip. */
export interface MenuEntry {
  label: string;
  href?: string;
  external?: boolean;
  disabledReason?: string;
}

// Order, labels and badges are those of the captured app-shell segment.
export const PRIMARY_NAV: readonly NavLink[] = [
  { label: "Home", href: "/", icon: NavHomeIcon },
  {
    label: "Explore",
    href: "/explore",
    icon: NavExploreIcon,
    activeIcon: NavExploreActiveIcon,
  },
  {
    label: "Perps",
    href: "/perps",
    icon: NavPerpsIcon,
    activeIcon: NavPerpsActiveIcon,
    badge: "New",
    disabledReason: "Perps is a deferred external product",
  },
  {
    label: "Leaderboard",
    href: "/leaderboard",
    icon: NavLeaderboardIcon,
    activeIcon: NavLeaderboardActiveIcon,
  },
  {
    label: "Live",
    href: "/live",
    icon: NavLiveIcon,
    activeIcon: NavLiveActiveIcon,
  },
];

export const DISCOVER_NAV: readonly NavLink[] = [
  { label: "GO", href: "/go", icon: NavGoIcon, activeIcon: NavGoActiveIcon },
  {
    label: "Mayhem",
    href: "/mayhem",
    icon: NavMayhemIcon,
    activeIcon: NavMayhemActiveIcon,
  },
  {
    label: "Holder rewards",
    href: "/holder-rewards",
    icon: NavHolderRewardsIcon,
    activeIcon: NavHolderRewardsActiveIcon,
    badge: "New",
  },
  {
    label: "$PUMP",
    href: "/pump-token",
    icon: NavPumpTokenIcon,
    disabledReason: "$PUMP pages are outside this reconstruction",
  },
  // Preserve the maintained read-only local portfolio route; this row is local design, not captured navigation.
  { label: "Portfolio", href: "/portfolio", icon: InfoBarPositionsIcon },
];

const NEEDS_SIGN_IN =
  "Requires sign-in, which this reconstruction does not implement";

/**
 * The Create menu of recovered factory 29306: "Create coin" (/create), then
 * "Go live", a callout entry (its i18n string was not recovered) and "Post bounty".
 */
export const CREATE_MENU: readonly MenuEntry[] = [
  { label: "Create coin", href: "/create" },
  { label: "Go live", disabledReason: NEEDS_SIGN_IN },
  { label: "Callout", disabledReason: NEEDS_SIGN_IN },
  { label: "Post bounty", disabledReason: NEEDS_SIGN_IN },
];

export const TERMINAL_URL = "https://trade.padre.gg/?utm_source=pumpweb";
export const SUPPORT_UNAVAILABLE =
  "Support (Intercom) is outside this reconstruction";

/**
 * The mobile "more" menu of recovered factory 29306, signed-out: Messages and
 * Profile need an account and are omitted.
 */
export const MOBILE_MORE_MENU: readonly MenuEntry[] = [
  { label: "Leaderboard", href: "/leaderboard" },
  { label: "Mayhem", href: "/mayhem" },
  { label: "Live", href: "/live" },
  { label: "Holder rewards", href: "/holder-rewards" },
  { label: "Support", disabledReason: SUPPORT_UNAVAILABLE },
  { label: "Terminal", href: TERMINAL_URL, external: true },
  { label: "$PUMP", href: "/pump-token" },
];

export const RESOURCE_LINKS: readonly MenuEntry[] = [
  { label: "PumpSwap", href: "https://swap.pump.fun", external: true },
  { label: "Fees", href: "/docs/fees" },
  { label: "Revenue", href: "https://fees.pump.fun/", external: true },
  {
    label: "Tech updates",
    href: "https://t.me/pump_tech_updates",
    external: true,
  },
  {
    label: "Wallet sign-in changes",
    href: "https://pump.fun/docs/wallet-login-changes",
    external: true,
  },
];

export const LEGAL_LINKS: readonly MenuEntry[] = [
  { label: "Privacy policy", href: "/docs/privacy-policy" },
  { label: "Terms of service", href: "/docs/terms-and-conditions" },
  {
    label: "Tokenized agent disclaimer",
    href: "https://pump.fun/docs/tokenized-agent-disclaimer",
    external: true,
  },
  {
    label: "Livestream policy",
    href: "https://pump.fun/docs/livestream-moderation-policy",
    external: true,
  },
  {
    label: "DMCA policy",
    href: "https://pump.fun/docs/dmca-policy",
    external: true,
  },
  {
    label: "Trademark guidelines",
    href: "https://pump.fun/docs/trademark-guidelines",
    external: true,
  },
  {
    label: "Charity coins",
    href: "https://pump.fun/docs/charitycoins",
    external: true,
  },
  {
    label: "Go.fun terms",
    href: "https://pump.fun/docs/go-fun-terms",
    external: true,
  },
];

export const BLOG_URL = "https://medium.com/@pumpdotfun_";

export const SOCIAL_LINKS: readonly {
  label: string;
  href: string;
  icon: Icon;
}[] = [
  { label: "X", href: "https://twitter.com/pumpfun", icon: XIcon },
  {
    label: "TikTok",
    href: "https://www.tiktok.com/@pump.fun",
    icon: TikTokIcon,
  },
  {
    label: "YouTube",
    href: "https://www.youtube.com/@pumpfunofficial",
    icon: YouTubeIcon,
  },
];

/**
 * Captured pages mark the link of their own route active. The home link is not
 * marked active on `/` in the capture, so it is never active here either.
 */
export function isNavActive(pathname: string, href: string): boolean {
  if (href === "/") return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}
