// The Start page: a search box over the shared bookmarks, laid out the way the
// injected browser home page lays them out. It used to be BookmarksTab in
// SimpleTabs.tsx -- a plain management card grid -- and moved out here for the
// same reason Cookies did, once it stopped being a list and nothing else.
//
// The bookmarks themselves are still org-shared Supabase rows; only the search
// engine choice is per-machine (see lib/searchEngines.ts).
import {useState} from 'react';
import {ChevronDown, Pencil, Plus, Search} from 'lucide-react';
import {BookmarkFavicon} from '../ui/BookmarkFavicon';
import {Popover} from '../ui/Popover';
import {normalizeBookmarkUrl} from '../../lib/bookmarks';
import {
  SEARCH_ENGINES,
  readSearchEngine,
  resolveQuery,
  writeSearchEngine,
} from '../../lib/searchEngines';
import {useWorkspace} from '../../workspace/WorkspaceProvider';
import type {SearchEngine} from '../../lib/searchEngines';
import type {SharedBookmark} from '../../types';

export function StartPageTab({onEditBookmark, onAddBookmark}: {
  onEditBookmark: (bookmark: SharedBookmark) => void;
  onAddBookmark: () => void;
}) {
  const {data} = useWorkspace();
  const bookmarks = data.state.shared_bookmarks;

  return (
    <section className="start-page">
      <SearchBox />
      <div className="start-grid">
        {bookmarks.map((bookmark) => (
          <BookmarkTile
            bookmark={bookmark}
            key={`${bookmark.title}-${bookmark.url}`}
            onEdit={() => onEditBookmark(bookmark)}
          />
        ))}
        <button className="start-tile start-tile-add" onClick={onAddBookmark}>
          <span className="start-tile-icon"><Plus size={20} /></span>
          <span className="start-tile-label">Add</span>
        </button>
      </div>
      {bookmarks.length === 0 && (
        <p className="empty-state">
          No shared bookmarks yet. Add one and it appears here and on every
          profile's browser start page.
        </p>
      )}
    </section>
  );
}

function SearchBox() {
  // Read once on mount rather than on every render: localStorage is the source
  // of truth across restarts, this state is the source of truth within a session.
  const [engine, setEngine] = useState<SearchEngine>(readSearchEngine);
  const [query, setQuery] = useState('');

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const url = resolveQuery(query, engine);
    if (!url) {
      return;
    }
    window.open(url, '_blank');
    setQuery('');
  }

  function pick(next: SearchEngine) {
    writeSearchEngine(next.id);
    setEngine(next);
  }

  return (
    <form className="start-search" onSubmit={submit}>
      <Search className="start-search-icon" size={17} />
      <input
        aria-label="Search or enter address"
        onChange={(event) => setQuery(event.target.value)}
        placeholder={`Search ${engine.name} or enter address`}
        type="text"
        value={query}
      />
      <Popover
        label="Search engine"
        panelClassName="engine-menu"
        trigger={<>{engine.name}<ChevronDown size={14} /></>}
        triggerClassName="start-engine"
        width={180}
      >
        {(close) => SEARCH_ENGINES.map((option) => (
          <button
            className={option.id === engine.id ? 'engine-option active' : 'engine-option'}
            key={option.id}
            onClick={() => {
              pick(option);
              close();
            }}
          >
            {option.name}
          </button>
        ))}
      </Popover>
    </form>
  );
}

function BookmarkTile({bookmark, onEdit}: {
  bookmark: SharedBookmark;
  onEdit: () => void;
}) {
  const url = normalizeBookmarkUrl(bookmark.url);
  const label = bookmark.title || url;
  return (
    <div className="start-tile">
      {/* The whole tile opens the site; Edit sits on top of it, so it has to be
        * a sibling rather than a child -- a button inside an anchor is invalid
        * and clicking it would navigate as well as open the dialog. */}
      <a className="start-tile-open" href={url} onClick={(event) => {
        event.preventDefault();
        window.open(url, '_blank');
      }} title={url}>
        <span className="start-tile-icon"><BookmarkFavicon bookmark={bookmark} /></span>
        <span className="start-tile-label">{label}</span>
      </a>
      <button
        aria-label={`Edit ${label}`}
        className="icon-button start-tile-edit"
        onClick={onEdit}
        title="Edit"
      >
        <Pencil size={13} />
      </button>
    </div>
  );
}
