import { useState } from 'react';
import ResourceManager, { type ResourceConfig } from './ResourceManager';

/**
 * Groups several resource managers behind a tab bar.
 *
 * Positions, projects and supervised theses all live on the Experience page;
 * degrees, awards and memberships all live on the About page. Splitting them
 * across separate admin URLs would mean navigating away and back to edit two
 * things that appear on the same public page.
 */

type Row = Record<string, unknown> & { id: number };

interface Tab {
  id: string;
  label: string;
  config: ResourceConfig;
  rows: Row[];
}

export default function TabbedResources({ tabs }: { tabs: Tab[] }) {
  const [active, setActive] = useState(tabs[0]?.id ?? '');
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];

  if (!current) return null;

  return (
    <>
      <div role="tablist" className="mb-6 flex flex-wrap gap-1 border-b border-line">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            onClick={() => setActive(tab.id)}
            className="-mb-px border-b-2 border-transparent px-4 py-2.5 text-sm text-ink-muted transition-colors hover:text-ink aria-selected:border-accent aria-selected:font-medium aria-selected:text-accent"
          >
            {tab.label}
            <span className="ml-1.5 tabular-nums opacity-60">{tab.rows.length}</span>
          </button>
        ))}
      </div>

      {/*
        `key` forces a fresh ResourceManager per tab. Without it, React would
        reuse the component instance and carry one tab's search query and open
        modal across into the next.
      */}
      <ResourceManager key={current.id} config={current.config} initial={current.rows} />
    </>
  );
}
