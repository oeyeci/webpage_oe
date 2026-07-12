/**
 * SEO helpers: canonical URLs, and the JSON-LD structured data that lets
 * Google understand this is a researcher's site rather than a blog.
 *
 * Schema.org types used:
 *   Person             — the site owner (About, Home)
 *   ScholarlyArticle   — each publication
 *   BlogPosting        — each blog post
 *   Event              — each activity
 *   BreadcrumbList     — every deep page
 *   WebSite            — the site itself, with a sitelinks search box
 */
import type { Profile, Publication } from './db/schema';
import { stripHtml, truncate } from './utils/text';

export interface SeoInput {
  title: string;
  description: string;
  canonical: string;
  image?: string;
  type?: 'website' | 'article' | 'profile';
  publishedTime?: string;
  modifiedTime?: string;
  tags?: string[];
  noindex?: boolean;
}

/** Absolute URL for a path, with no double slashes and no trailing slash. */
export function absoluteUrl(path: string, siteUrl: string): string {
  const base = siteUrl.replace(/\/+$/, '');
  const clean = path.startsWith('/') ? path : `/${path}`;
  return clean === '/' ? base : `${base}${clean.replace(/\/+$/, '')}`;
}

/** Meta description: strip markup, collapse whitespace, cut at a word boundary. */
export function metaDescription(source: string | null | undefined, fallback: string): string {
  const text = source ? stripHtml(source) : '';
  return truncate(text || fallback, 158);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * JSON-LD builders
 * ═══════════════════════════════════════════════════════════════════════════ */

type Json = Record<string, unknown>;

/** Drops null/undefined/empty entries so the emitted JSON-LD stays clean. */
function compact(input: Json): Json {
  return Object.fromEntries(
    Object.entries(input).filter(([, v]) => {
      if (v == null) return false;
      if (typeof v === 'string') return v.trim() !== '';
      if (Array.isArray(v)) return v.length > 0;
      return true;
    }),
  );
}

export function personSchema(profile: Profile, siteUrl: string, imageUrl?: string): Json {
  const sameAs = [
    profile.orcid,
    profile.googleScholar,
    profile.researchGate,
    profile.github,
    profile.linkedin,
    profile.twitter,
    profile.webOfScience,
  ].filter((value): value is string => Boolean(value));

  return compact({
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': `${siteUrl}/#person`,
    name: profile.fullName,
    honorificPrefix: profile.honorific,
    jobTitle: profile.title,
    description: profile.summary,
    email: profile.email ? `mailto:${profile.email}` : undefined,
    url: siteUrl,
    image: imageUrl,
    sameAs,
    worksFor: profile.institution
      ? compact({
          '@type': 'CollegeOrUniversity',
          name: profile.institution,
          department: profile.department
            ? { '@type': 'Organization', name: profile.department }
            : undefined,
        })
      : undefined,
    address: profile.address
      ? compact({ '@type': 'PostalAddress', streetAddress: profile.address })
      : undefined,
    knowsAbout: [
      'Quantum Machine Learning',
      'Smart Grids',
      'Artificial Intelligence',
      'Computational Materials Science',
      'Renewable Energy Forecasting',
    ],
  });
}

export function websiteSchema(siteUrl: string, name: string, description: string): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${siteUrl}/#website`,
    url: siteUrl,
    name,
    description,
    inLanguage: 'en',
    publisher: { '@id': `${siteUrl}/#person` },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${siteUrl}/blog?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

export function scholarlyArticleSchema(
  publication: Publication & { authorList?: Array<{ fullName: string }> },
  siteUrl: string,
): Json {
  const authors = (publication.authorList ?? []).map((a) => ({
    '@type': 'Person',
    name: a.fullName,
  }));

  return compact({
    '@context': 'https://schema.org',
    '@type': publication.category === 'book' ? 'Book' : 'ScholarlyArticle',
    headline: publication.title,
    name: publication.title,
    author: authors.length > 0 ? authors : undefined,
    datePublished: publication.year > 0 ? String(publication.year) : undefined,
    isPartOf: publication.journal
      ? { '@type': 'Periodical', name: publication.journal }
      : undefined,
    publisher: publication.publisher
      ? { '@type': 'Organization', name: publication.publisher }
      : undefined,
    pagination: publication.pages,
    volumeNumber: publication.volume,
    issueNumber: publication.number,
    identifier: publication.doi ? `https://doi.org/${publication.doi}` : undefined,
    sameAs: publication.doi ? `https://doi.org/${publication.doi}` : publication.url,
    abstract: publication.abstract,
    url: `${siteUrl}/publications#${publication.citeKey}`,
    isAccessibleForFree: true,
  });
}

export function blogPostingSchema(
  post: {
    title: string;
    slug: string;
    excerpt: string | null;
    publishedAt: Date | null;
    updatedAt: Date;
    readingMinutes: number;
    tags?: Array<{ name: string }>;
  },
  siteUrl: string,
  authorName: string,
  imageUrl?: string,
): Json {
  const url = `${siteUrl}/blog/${post.slug}`;

  return compact({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    '@id': `${url}#post`,
    headline: post.title,
    description: post.excerpt,
    image: imageUrl,
    datePublished: post.publishedAt?.toISOString(),
    dateModified: post.updatedAt.toISOString(),
    author: { '@type': 'Person', name: authorName, url: `${siteUrl}/about` },
    publisher: { '@id': `${siteUrl}/#person` },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    keywords: post.tags?.map((t) => t.name).join(', '),
    timeRequired: `PT${post.readingMinutes}M`,
    inLanguage: 'en',
  });
}

export function eventSchema(
  activity: {
    title: string;
    slug: string;
    activityDate: string;
    endDate: string | null;
    location: string | null;
    excerpt: string | null;
  },
  siteUrl: string,
  imageUrl?: string,
): Json {
  return compact({
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: activity.title,
    description: activity.excerpt,
    startDate: activity.activityDate,
    endDate: activity.endDate ?? activity.activityDate,
    image: imageUrl,
    url: `${siteUrl}/activities/${activity.slug}`,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: activity.location
      ? { '@type': 'Place', name: activity.location, address: activity.location }
      : undefined,
    performer: { '@id': `${siteUrl}/#person` },
  });
}

export function breadcrumbSchema(
  trail: Array<{ name: string; url: string }>,
  siteUrl: string,
): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.url, siteUrl),
    })),
  };
}
