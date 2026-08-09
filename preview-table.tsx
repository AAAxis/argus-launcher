// SCRATCH — throwaway. The profiles tab's shell, drawn with the tab's own
// markup: .table-frame > .table-toolbar + .folder-row + .selection-toolbar +
// .table-wrap + .pagination-bar, inside a real .content so the flex/scroll
// rules that only exist there are actually exercised.
//
// The questions it exists to answer, none of which a unit test can:
//   - is the frame borderless and still legible against the page, both themes?
//   - in dark, is the table INSIDE darker than the frame around it?
//   - do the folder cards and the search box survive a frame that is --raised's
//     own colour in dark?
//   - are the inner corners concentric with the outer ones?
//   - does the table still scroll inside the frame, with the toolbar and the
//     pager staying put?
//
//   npx vite --config vite.preview.config.ts
//   open http://127.0.0.1:5199/preview-table.html?theme=dark
import {createRoot} from 'react-dom/client';
import {ChevronDown, FolderPlus, Trash2, UsersRound} from 'lucide-react';
import {PaginationBar} from './src/components/ui/PaginationBar';
import './src/styles.css';

const FOLDERS = [
  {name: 'All profiles', count: 42, active: true},
  {name: 'Facebook farm', count: 18, active: false},
  {name: 'Marketplace', count: 7, active: false},
];

// Enough rows to overflow the viewport, which is the only way to see whether
// the table scrolls inside the frame or takes the page with it.
const ROWS = Array.from({length: 24}, (_, i) => ({
  name: `Profile ${i + 1}`,
  status: i % 3 === 0 ? 'Ready' : 'Warming up',
  proxy: `res-${100 + i}.example.net:8080`,
  tag: ['Facebook', 'Instagram', 'TikTok'][i % 3],
}));

function Preview() {
  return (
    <div className="content">
      <section className="topbar">
        <h1 className="page-title">Profiles</h1>
      </section>

      <div className="table-frame">
        <section className="table-toolbar">
          <input placeholder="Search profiles by name or tag" readOnly type="text" />
          <select defaultValue="all">
            <option value="all">Any status</option>
          </select>
          <button className="filter-trigger" type="button">
            Tags <ChevronDown size={15} />
          </button>
          <button className="filter-trigger columns-trigger" type="button">
            Columns <ChevronDown size={15} />
          </button>
        </section>

        <section aria-label="Folders" className="folder-row">
          {FOLDERS.map((folder) => (
            <button
              className={folder.active ? 'folder-card active' : 'folder-card'}
              key={folder.name}
              type="button"
            >
              <span className="folder-glyph"><UsersRound size={15} strokeWidth={1.75} /></span>
              <span className="folder-card-name">{folder.name}</span>
              <span className="folder-card-count">{folder.count}</span>
            </button>
          ))}
          <button className="folder-card" type="button">
            <span className="folder-glyph"><Trash2 size={15} strokeWidth={1.75} /></span>
            <span className="folder-card-name">Trash</span>
            <span className="folder-card-count">3</span>
          </button>
          <button className="folder-card folder-card-new" type="button">
            <span className="folder-glyph"><FolderPlus size={15} strokeWidth={1.75} /></span>
            <span className="folder-card-name">New folder</span>
          </button>
        </section>

        {/* Six ghost buttons in a row, which is the case --raised-soft gets
            wrong on a frame that is its own colour in dark. */}
        <section className="selection-toolbar">
          <div className="selection-toolbar-actions">
            <button className="ghost" type="button">Move to folder</button>
            <button className="ghost" type="button">Check proxies</button>
            <button className="ghost" type="button">Import cookies</button>
            <button className="ghost" type="button">Export selected</button>
            <button className="ghost" type="button">Share…</button>
            <button className="danger ghost" type="button">Delete selected</button>
          </div>
        </section>

        <section className="table-wrap">
          <table>
            <thead>
              <tr>
                <th />
                <th>Name</th>
                <th>Status</th>
                <th>Proxy</th>
                <th>Tag</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, i) => (
                <tr className={i === 1 ? 'is-new' : ''} key={row.name}>
                  <td className="checkbox-cell">
                    <input readOnly type="checkbox" />
                  </td>
                  <td>{row.name}</td>
                  <td>
                    <span className="status-chip status-active is-plain">{row.status}</span>
                  </td>
                  <td>{row.proxy}</td>
                  <td>{row.tag}</td>
                  <td className="actions-cell">
                    <div className="row-actions">
                      <button className="ghost" type="button">Edit</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <PaginationBar
          onPage={() => {}}
          onPageSize={() => {}}
          page={0}
          pageSize={25}
          total={42}
          totalPages={2}
        />
      </div>
    </div>
  );
}

const theme = new URLSearchParams(location.search).get('theme');
if (theme) {
  document.documentElement.dataset.theme = theme;
}
createRoot(document.getElementById('root')!).render(<Preview />);
