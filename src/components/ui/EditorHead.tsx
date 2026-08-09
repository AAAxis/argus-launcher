// The header both full-size editors wear: a mark you click to change, the name
// as the heading, a line of context under it, and every action the dialog has.
//
// One header instead of a header and a footer. The things you can do to an
// automation used to be in three places -- Save, Cancel and Delete in the
// footer, Run halfway down the settings column -- and they are one set of
// actions, so they now read as one, directly under the name of the thing they
// act on. The bar is sticky, which is the part that makes this an improvement
// rather than a move: a footer is always reachable on a dialog this tall and a
// header that scrolled away would not be.
//
// Shared rather than copied. The profile editor was the last dialog still on
// the title/subtitle/footer arrangement, and a second hand-built copy of this
// bar is two copies to drift -- which is the same argument FormGroup and
// ProfileAvatar are already here on.
//
// The host must carry `editor-modal` in its Modal className: the sticky rule,
// and the one that lifts Modal's close X out of the flex flow, are written
// against it. See styles/features/editor-head.css.
import {useLayoutEffect, useRef} from 'react';
import {Popover} from './Popover';
import {TitleField} from './TitleField';
import type {ReactNode} from 'react';

export function EditorHead({
  mark,
  markLabel,
  markPop,
  noun,
  name,
  onNameChange,
  meta,
  actions,
  error,
}: {
  // The glyph that stands for this thing elsewhere in the app -- an
  // AutomationMark, a ProfileAvatar. It IS the popover's trigger, so changing
  // it means pressing the thing you are changing.
  mark: ReactNode;
  // Accessible name for that trigger, e.g. "Change the icon and colour for Acme".
  markLabel: string;
  // What the popover holds: the pickers that set the mark. Omit for a dialog
  // whose mark is not editable, and the mark renders as a plain glyph.
  markPop?: ReactNode;
  noun: string;
  name: string;
  // Omit for a dialog whose heading is not a name the user owns -- the three
  // importers, whose title is what the dialog IS ("Import proxies") rather than
  // what it is editing. The heading then renders as text with no pencil, and
  // `noun` is unused. Every other part of the bar is the same, which is the
  // point: an importer that wore a hand-built lookalike of this header would be
  // a second copy to drift, and drift is what put the three import dialogs on
  // three different layouts in the first place.
  onNameChange?: (name: string) => void;
  // The second line -- "6 steps", a status chip and a folder. Its own block
  // rather than a caption hanging off the name; see .editor-head-meta.
  meta?: ReactNode;
  actions: ReactNode;
  // A failed save, under the button that failed rather than at the bottom of a
  // dialog that scrolls.
  error?: ReactNode;
}) {
  const head = useRef<HTMLDivElement>(null);

  // Publish the bar's height as --editor-head-h on the dialog panel, so anything
  // else that sticks inside the same scroll container can park below it instead
  // of under it. The profile editor's summary column is sticky at the top of
  // that container, and without this the bar covers its first 116px -- its own
  // heading and the first group's -- the moment the form scrolls.
  //
  // Measured rather than guessed: this bar is two rows, and the first of them
  // grows when a long name wraps, so no constant is right for both.
  useLayoutEffect(() => {
    const node = head.current;
    const panel = node?.closest('.profile-modal') as HTMLElement | null;
    if (!node || !panel) {
      return;
    }
    const observer = new ResizeObserver(() => {
      // offsetHeight is the bar's own box; the header around it adds its
      // padding, which is what the sticky element actually has to clear.
      const header = node.parentElement as HTMLElement | null;
      panel.style.setProperty('--editor-head-h', `${header?.offsetHeight ?? node.offsetHeight}px`);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="editor-head" ref={head}>
      <div className="editor-head-title">
        {markPop ? (
          <Popover
            label={markLabel}
            panelClassName="editor-mark-pop"
            triggerClassName="editor-mark-trigger"
            trigger={mark}
            width={320}
          >
            {markPop}
          </Popover>
        ) : (
          <span className="editor-mark-static">{mark}</span>
        )}
        <div className="editor-head-name">
          <h2>
            {onNameChange ? (
              <TitleField noun={noun} value={name} onChange={onNameChange} />
            ) : (
              // The same box TitleField's read state draws, minus the pencil, so
              // a fixed heading sits on exactly the line an editable one does.
              <span className="editor-title">
                <span className="editor-title-text">{name}</span>
              </span>
            )}
          </h2>
        </div>
      </div>

      {/* Two rows, not three. The context line shares the action row rather than
          hanging under the name: it is one short phrase, the actions are pinned
          to the trailing edge, and the space between them was the whole of a
          third row. */}
      <div className="editor-head-actions">
        {meta && <p className="editor-head-meta">{meta}</p>}
        {actions}
      </div>

      {error}
    </div>
  );
}
