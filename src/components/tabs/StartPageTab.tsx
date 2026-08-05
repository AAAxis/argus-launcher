// The Start page: a search box over the shared bookmarks and the automations
// pinned to start pages, laid out the way the injected browser home page lays
// them out. It used to be BookmarksTab in SimpleTabs.tsx -- a plain management
// card grid -- and moved out here for the same reason Cookies did, once it
// stopped being a list and nothing else.
//
// It is deliberately a preview of the generated page (src/lib/homePage.ts) and
// the place you decide what goes on it, in that order: same 640px column, same
// five-tile grid, same two sections. What you can do here that you cannot do
// there is choose -- pin a workflow, add a bookmark. Running is the browser's
// job, because a run needs a profile and a session, and this tab has neither.
//
// The bookmarks and the automations are org-shared Supabase rows; only the
// search engine choice is per-machine (see lib/searchEngines.ts).
import {useState} from 'react';
import {Bookmark, ChevronDown, Pencil, Play, Plus, Search, X} from 'lucide-react';
import {BookmarkFavicon} from '../ui/BookmarkFavicon';
import {Popover} from '../ui/Popover';
import {normalizeBookmarkUrl} from '../../lib/bookmarks';
import {
  SEARCH_ENGINES,
  readSearchEngine,
  resolveQuery,
  writeSearchEngine,
} from '../../lib/searchEngines';
import {startPageAutomations} from '../../lib/startPageAutomations';
import {useWorkspace} from '../../workspace/WorkspaceProvider';
import type {SearchEngine} from '../../lib/searchEngines';
import type {ArgusAutomation, SharedBookmark} from '../../types';

export function StartPageTab({onEditBookmark, onAddBookmark}: {
  onEditBookmark: (bookmark: SharedBookmark) => void;
  onAddBookmark: () => void;
}) {
  const {data} = useWorkspace();
  const bookmarks = data.state.shared_bookmarks;

  return (
    <section className="start-page">
      {/* The mark, above the search box on both surfaces. The generated browser
          page opens on an anonymous session with nothing on it that says who
          made it; this tab is the preview of that page, so it carries the same
          thing in the same place or the two stop matching.
          A masked span rather than an <img>: the art is black line work and
          would disappear against the dark theme. Same construction as the
          sidebar's .brand-mark. */}
      <p className="start-brand">
        <span aria-hidden="true" className="start-brand-mark" />
        <span className="visually-hidden">Argus</span>
      </p>
      <SearchBox />
      {/* The same note block the Integrations and Extensions tabs use, above the
          grid rather than under it. This was a bare grey sentence below the
          tiles, which put the one line explaining what the tab is for after the
          thing it explains -- and left the Add tile looking like the whole
          answer to an empty page. Only shown while the grid is empty: on a tab
          you aim at rather than read, a standing paragraph is in the way. */}
      {bookmarks.length === 0 && (
        <section className="api-note">
          <Bookmark size={18} />
          <span>
            No shared bookmarks yet. Add one and it appears here and on every
            profile's browser start page.
          </span>
        </section>
      )}
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
      <AutomationSection />
    </section>
  );
}

// What the browser's start page will offer as run tiles, and the one place to
// change it.
//
// `pinned` was already a field, but the only way to set it was a checkbox in
// the automation editor's sidebar -- so the page that shows the tiles had no
// say in which tiles it showed, and nothing in the app connected "pin this
// workflow" to "a button appears inside the browser". Pinning here also has a
// consequence worth being able to see: a launch only opens a debugging port
// when it has tiles to run (see useProfileActions.launch), so this list is what
// decides that.
function AutomationSection() {
  const {data, automations: automationActions} = useWorkspace();
  const all = data.state.automations;
  const pinned = startPageAutomations(all);
  const unpinned = all.filter((item) => !item.pinned);

  // Nothing to pin and nothing pinned: a section header over an Add tile that
  // opens an empty menu is worse than no section. The Automations tab is where
  // a workflow gets made, and it says so there.
  if (all.length === 0) {
    return null;
  }

  return (
    <section className="start-automations">
      <h2 className="start-section-label">Automations</h2>
      <p className="start-section-note">
        Pinned workflows appear on every profile's browser start page and run
        from there in that profile's session.
      </p>
      <div className="start-grid">
        {pinned.map((automation) => (
          <AutomationTile
            automation={automation}
            key={automation.id}
            onUnpin={() => void automationActions.setPinned(automation, false)}
          />
        ))}
        {/* Disabled rather than hidden once everything is pinned: the tile is
          * how you learn this row is something you control, and a control that
          * vanishes when it has nothing left to offer teaches nothing. */}
        <Popover
          disabled={unpinned.length === 0}
          label="Pin an automation"
          panelClassName="engine-menu"
          trigger={
            <>
              <span className="start-tile-icon"><Plus size={20} /></span>
              <span className="start-tile-label">Pin</span>
            </>
          }
          triggerClassName="start-tile start-tile-add"
          width={220}
        >
          {(close) => unpinned.map((automation) => (
            <button
              className="engine-option"
              key={automation.id}
              onClick={() => {
                void automationActions.setPinned(automation, true);
                close();
              }}
            >
              {automation.name}
            </button>
          ))}
        </Popover>
      </div>
    </section>
  );
}

function AutomationTile({automation, onUnpin}: {
  automation: ArgusAutomation;
  onUnpin: () => void;
}) {
  const label = automation.name || 'Automation';
  return (
    <div className="start-tile">
      {/* A div, not a button: this tile is a preview of something the browser
        * runs, and there is no session here to run it in. Making it look
        * pressable would promise an action this tab cannot perform. */}
      <div className="start-tile-open start-tile-static" title={label}>
        <span className="start-tile-icon"><Play size={18} /></span>
        <span className="start-tile-label">{label}</span>
      </div>
      <button
        aria-label={`Remove ${label} from start pages`}
        className="icon-button start-tile-edit"
        onClick={onUnpin}
        title="Remove from start pages"
      >
        <X size={13} />
      </button>
    </div>
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
