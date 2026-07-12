import { useMemo, useState } from 'react';
import { api } from '../../lib/admin/client';
import { Confirm, Pill, Toaster, useToasts } from './ui';

interface Post {
  id: number;
  title: string;
  slug: string;
  status: 'draft' | 'scheduled' | 'published';
  isFeatured: boolean;
  publishedAt: string | null;
  scheduledFor: string | null;
  readingMinutes: number;
  viewCount: number;
  categoryName: string | null;
}

const FILTERS = ['all', 'published', 'scheduled', 'draft'] as const;

export default function PostList({ initial }: { initial: Post[] }) {
  const toast = useToasts();

  const [posts, setPosts] = useState(initial);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [query, setQuery] = useState('');
  const [deleting, setDeleting] = useState<Post | null>(null);

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: posts.length };
    for (const post of posts) map[post.status] = (map[post.status] ?? 0) + 1;
    return map;
  }, [posts]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return posts.filter((post) => {
      if (filter !== 'all' && post.status !== filter) return false;
      return !needle || post.title.toLowerCase().includes(needle);
    });
  }, [posts, filter, query]);

  const confirmDelete = async () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);

    try {
      await api.delete(`/api/admin/blog/${target.id}`);
      setPosts((prev) => prev.filter((post) => post.id !== target.id));
      toast.success(`Deleted “${target.title}”.`);
    } catch {
      toast.error('Could not delete that post.');
    }
  };

  const formatDate = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      : '—';

  /** A scheduled post whose time has passed is already live, whatever the flag says. */
  const isLive = (post: Post) =>
    post.status === 'published' ||
    (post.status === 'scheduled' &&
      post.scheduledFor !== null &&
      new Date(post.scheduledFor) <= new Date());

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.filter((f) => f === 'all' || counts[f]).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setFilter(name)}
              aria-pressed={filter === name}
              className="chip capitalize transition-colors hover:border-accent hover:text-accent aria-pressed:border-transparent aria-pressed:bg-accent aria-pressed:text-white dark:aria-pressed:text-[#0b0c0f]"
            >
              {name}
              <span className="tabular-nums opacity-60">{counts[name] ?? 0}</span>
            </button>
          ))}
        </div>

        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search posts…"
          className="input !py-2 !text-sm sm:max-w-xs"
          aria-label="Search posts"
        />
      </div>

      <ul className="mt-5 space-y-2">
        {visible.map((post) => (
          <li key={post.id} className="card flex flex-wrap items-center gap-4 p-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <Pill
                  tone={
                    post.status === 'published'
                      ? 'success'
                      : post.status === 'scheduled'
                        ? 'accent'
                        : 'neutral'
                  }
                >
                  {post.status}
                </Pill>

                {post.status === 'scheduled' && isLive(post) && (
                  <Pill tone="success">live now</Pill>
                )}
                {post.isFeatured && <Pill tone="accent">featured</Pill>}
                {post.categoryName && <Pill>{post.categoryName}</Pill>}
              </div>

              <h3 className="mt-2 truncate font-medium">{post.title}</h3>

              <p className="mt-0.5 text-xs text-ink-subtle">
                {post.status === 'scheduled'
                  ? `Publishes ${formatDate(post.scheduledFor)}`
                  : formatDate(post.publishedAt)}
                {' · '}
                {post.readingMinutes} min read
                {post.viewCount > 0 && ` · ${post.viewCount.toLocaleString()} views`}
              </p>
            </div>

            <div className="flex shrink-0 gap-1">
              <a
                href={`/blog/${post.slug}`}
                target="_blank"
                rel="noopener"
                className="btn btn-ghost !px-3 !text-xs"
              >
                View
              </a>
              <a href={`/admin/blog/${post.id}`} className="btn btn-secondary !px-3 !text-xs">
                Edit
              </a>
              <button
                type="button"
                onClick={() => setDeleting(post)}
                className="btn btn-danger !px-3 !text-xs"
              >
                Delete
              </button>
            </div>
          </li>
        ))}

        {visible.length === 0 && (
          <li className="card py-16 text-center text-sm text-ink-muted">
            {posts.length === 0 ? 'No posts yet.' : 'No posts match your filters.'}
          </li>
        )}
      </ul>

      <Confirm
        open={deleting !== null}
        title="Delete post"
        message={`“${deleting?.title}” and its tags will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />

      <Toaster toasts={toast.toasts} />
    </>
  );
}
