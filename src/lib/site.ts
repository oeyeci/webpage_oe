/** Static site configuration — navigation and social link metadata. */

export interface NavItem {
  label: string;
  href: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'About', href: '/about' },
  { label: 'Experience', href: '/experiences' },
  { label: 'Publications', href: '/publications' },
  { label: 'Blog', href: '/blog' },
  { label: 'Skills', href: '/skills' },
  { label: 'Activities', href: '/activities' },
  { label: 'Contact', href: '/contact' },
] as const;

export const ADMIN_NAV = [
  { label: 'Dashboard', href: '/admin', icon: 'LayoutDashboard' },
  { label: 'Publications', href: '/admin/publications', icon: 'BookOpen' },
  { label: 'Blog', href: '/admin/blog', icon: 'PenLine' },
  { label: 'Activities', href: '/admin/activities', icon: 'CalendarDays' },
  { label: 'Experience', href: '/admin/experiences', icon: 'Briefcase' },
  { label: 'Skills', href: '/admin/skills', icon: 'Sparkles' },
  { label: 'About', href: '/admin/about', icon: 'User' },
  { label: 'Media', href: '/admin/media', icon: 'Images' },
  { label: 'Messages', href: '/admin/contacts', icon: 'Mail' },
  { label: 'Settings', href: '/admin/settings', icon: 'Settings' },
  { label: 'Logs', href: '/admin/logs', icon: 'ScrollText' },
] as const;

/** Social profiles, resolved against the profile row. Empty values are dropped. */
export interface SocialLink {
  /** Key into BRAND_MARKS — drives which logo is rendered. */
  brand: string;
  label: string;
  href: string;
}

/**
 * Ordered deliberately: the academic identifiers come first.
 *
 * On a researcher's site ORCID and Google Scholar are the links people actually
 * follow — they are the professional credential. GitHub and LinkedIn are
 * supporting evidence, and email is the fallback. Sorting them by what a
 * visiting academic is looking for beats sorting them by what a startup would.
 */
export function socialLinks(profile: {
  orcid?: string | null;
  googleScholar?: string | null;
  researchGate?: string | null;
  github?: string | null;
  linkedin?: string | null;
  twitter?: string | null;
  email?: string | null;
}): SocialLink[] {
  const entries: Array<[string, string, string | null | undefined]> = [
    ['orcid', 'ORCID', profile.orcid],
    ['googlescholar', 'Google Scholar', profile.googleScholar],
    ['researchgate', 'ResearchGate', profile.researchGate],
    ['github', 'GitHub', profile.github],
    ['linkedin', 'LinkedIn', profile.linkedin],
    ['x', 'X', profile.twitter],
    ['email', 'Email', profile.email ? `mailto:${profile.email}` : null],
  ];

  return entries
    .filter(([, , href]) => Boolean(href))
    .map(([brand, label, href]) => ({ brand, label, href: href! }));
}
