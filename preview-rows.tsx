// SCRATCH — throwaway. Every row state a table can be in, side by side, so the
// "arrived since you last looked" tint can be screenshotted against the ones it
// has to coexist with. The markup is the tabs' markup exactly: .table-wrap >
// table > tbody > tr, first cell .checkbox-cell, last cell .actions-cell.
//
// The one question it exists to answer: the accent bar is an inset box-shadow,
// and Chromium will not paint box-shadow on a <tr> under border-collapse:
// collapse, so it rides td:first-child instead. That is a rule only a
// screenshot can prove.
//
//   npx vite --config vite.preview.config.ts
//   open http://127.0.0.1:5199/preview-rows.html?theme=dark
import {createRoot} from 'react-dom/client';
import './src/styles.css';

const ROWS: Array<{name: string; className: string; note: string}> = [
  {name: 'Ordinary row', className: '', note: 'the baseline'},
  {name: 'Arrived since you last looked', className: 'is-new', note: 'green + accent bar'},
  {name: 'Selected row', className: 'selected', note: 'var(--hover)'},
  {name: 'Selected AND new', className: 'selected is-new', note: 'selection wins the fill'},
  {name: 'Checked row', className: 'row-checked', note: 'accent tint'},
  {name: 'Checked AND new', className: 'row-checked is-new', note: 'check wins the fill'},
];

function Preview() {
  return (
    // Not .app-shell: that is a grid whose first column is the sidebar, and
    // without one .content collapses to a few hundred pixels. This harness is
    // about the rows, so it takes the padding and lets the table have the page.
    <main style={{background: 'var(--surface)', minHeight: '100vh', padding: 24}}>
      <section>
        <h1 style={{fontSize: 18, margin: '0 0 16px'}}>Row states</h1>
        <section className="table-wrap">
          <table>
            <thead>
              <tr>
                <th />
                <th>Name</th>
                <th>Status</th>
                <th>What it shows</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr className={row.className} key={row.name}>
                  <td className="checkbox-cell">
                    <input readOnly checked={row.className.includes('row-checked')} type="checkbox" />
                  </td>
                  <td>{row.name}</td>
                  <td><span className="status-chip status-active is-plain">Ready</span></td>
                  <td>{row.note}</td>
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
      </section>
    </main>
  );
}

document.documentElement.dataset.theme =
  new URLSearchParams(window.location.search).get('theme') || 'light';
createRoot(document.getElementById('root')!).render(<Preview />);
